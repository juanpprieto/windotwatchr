'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { highlight } from 'sugar-high';
import { useWatchWindot } from 'windotwatchr/react';
import { ReadinessDemo } from '../../../shared/ReadinessDemo';

/** next/script does not auto-prepend basePath — resolve it once here. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * Shape of a rendered Acme promo component returned by `components.create()`.
 *
 * Models real SDK patterns where the component factory returns an object
 * with lifecycle methods (`render`, `update`, `destroy`).
 */
interface AcmeComponent {
  type: string;
  amount: number;
  pageType: string;
  rendered: boolean;
  render: (selector: string) => AcmeComponent;
  update: (opts: { amount: number }) => AcmeComponent;
  destroy: () => void;
}

/**
 * Shape of `acmePayments.ui.components` — the deep-nested API surface.
 *
 * This is the value at `window.acmePayments.ui.components` that both
 * the old-way polling and the windotwatchr watcher target. Available
 * ~800ms after the script tag loads (simulating async SDK initialization).
 */
interface AcmeComponents {
  create: (type: string, opts: { amount: number; pageType: string }) => AcmeComponent;
  render: (selector: string) => void;
}

const OLD_WAY_CODE = `function BNPLPromo({ amount }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timer;
    let cancelled = false;
    let component;
    const check = () => {
      if (cancelled) return;
      if (window?.acmePayments?.ui?.components) {
        setReady(true);
        component = acmePayments.ui.components
          .create('promo', { amount, pageType: 'product' });
        component.render('#container');
      } else {
        timer = setTimeout(check, 100);
      }
    };
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      component?.destroy();
    };
  }, [amount]);

  return <><p>{ready ? 'Ready' : 'Loading...'}</p>
    <div id="container" /></>;
}`;

const NEW_WAY_CODE = `function BNPLPromo({ amount }) {
  const { value: components, status } =
    useWatchWindot('acmePayments.ui.components');

  useEffect(() => {
    if (!components) return;
    const component = components.create('promo', { amount, pageType: 'product' });
    component.render('#container');
    return () => component.destroy();
  }, [components, amount]);

  return (
    <>
      <p>Status: {status}</p>
      <div id="container" />
    </>
  );
}`;

/** Catppuccin Mocha CSS variables for sugar-high syntax tokens. */
const SH_VARS: Record<string, string> = {
  '--sh-class': '#f9e2af',
  '--sh-identifier': '#cdd6f4',
  '--sh-sign': '#89dceb',
  '--sh-property': '#89b4fa',
  '--sh-entity': '#fab387',
  '--sh-jsxliterals': '#a6e3a1',
  '--sh-string': '#a6e3a1',
  '--sh-keyword': '#cba6f7',
  '--sh-comment': '#6c7086',
};

function CodeSnippet({ code }: { code: string }) {
  const html = highlight(code);
  return (
    <pre
      style={{
        backgroundColor: '#181825',
        padding: '1rem',
        borderRadius: '8px',
        fontSize: '0.8rem',
        lineHeight: 1.5,
        overflowX: 'auto',
        margin: '0.5rem 0 1rem',
        color: '#cdd6f4',
        ...SH_VARS,
      }}
    >
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

export default function PaymentsPage() {
  return (
    <main>
      <h1 style={{ color: '#cba6f7' }}>Payments — Readiness Demo</h1>
      <Link href="/" style={{ color: '#89b4fa', textDecoration: 'none' }}>&larr; Home</Link>
      <ReadinessDemo />
      <h2 style={{ color: '#cdd6f4' }}>Compare two working integrations</h2>
      <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem', maxWidth: '72ch' }}>
        Side-by-side comparison of detecting a deeply nested payment SDK
        (<code style={{ color: '#b4befe' }}>acmePayments.ui.components</code>, 3 levels deep).
        The left column uses the traditional setTimeout polling approach. The right column uses
        a single <code style={{ color: '#b4befe' }}>useWatchWindot</code> call. Both render a
        live promo widget when the SDK is ready. The third-party script tag is loaded separately
        in the page layout and is not shown in the code snippets below.
      </p>
      <Script src={`${BASE}/scripts/acme-payments.js`} strategy="afterInteractive" />
      <div className="payment-comparison">
        <div>
          <h3 style={{ color: '#cdd6f4' }}>Hand-written polling</h3>
          <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem' }}>
            A cancellable setTimeout loop checks this API every 100ms. This is a valid integration;
            you own the checking, scheduling and cleanup. A script load event alone does not establish readiness.
          </p>
          <OldWayPromo amount={4999} />
          <details><summary>Show polling code</summary><CodeSnippet code={OLD_WAY_CODE} /></details>
        </div>
        <div>
          <h3 style={{ color: '#cdd6f4' }}>windotwatchr</h3>
          <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem' }}>
            One hook manages detection and unmount cleanup. Default auto combines assignment
            interception with snapshot polling. Both integrations render the same result.
          </p>
          <NewWayPromo amount={4999} />
          <details><summary>Show hook code</summary><CodeSnippet code={NEW_WAY_CODE} /></details>
        </div>
      </div>
    </main>
  );
}

/**
 * Traditional approach to detecting a third-party SDK.
 *
 * Poll the API every 100ms, owning cancellation and component cleanup.
 * The guided demo above illustrates script loading separately from usability.
 *
 * @param props.amount - Dollar amount in cents to display in the promo widget.
 */
function OldWayPromo({ amount }: { amount: number }) {
  const [ready, setReady] = useState(false);
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let component: AcmeComponent | undefined;
    const check = () => {
      if (cancelled) { return; }
      const w = window as unknown as Record<string, unknown>;
      const ap = w.acmePayments as { ui?: { components?: AcmeComponents } } | undefined;
      if (ap?.ui?.components) {
        if (cancelled) { return; }
        setReady(true);
        setDetectedAt(Date.now());
        component = ap.ui.components.create('promo', {
          amount,
          pageType: 'product',
        });
        if (containerRef.current) {
          component.render('#old-way-container');
        }
      } else {
        setPollCount((c) => c + 1);
        timer = setTimeout(check, 100);
      }
    };
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      component?.destroy();
    };
  }, [amount]);

  return (
    <div
      data-testid="old-way"
      data-status={ready ? 'ready' : 'polling'}
      data-detected-at={detectedAt ?? ''}
      style={{
        padding: '1rem',
        borderRadius: '8px',
        backgroundColor: '#313244',
      }}
    >
      <div style={{ marginBottom: '0.75rem' }}>
        {!ready && (
          <p style={{ color: '#6c7086', margin: 0 }}>
            Polling every 100ms... ({pollCount} polls)
          </p>
        )}
        {ready && (
          <p style={{ color: '#a6e3a1', margin: 0 }}>
            Detected via polling
          </p>
        )}
      </div>
      <div id="old-way-container" ref={containerRef} />
    </div>
  );
}

/**
 * windotwatchr approach — interception with optional polling, event-driven SDK detection.
 *
 * Uses `useWatchWindot<AcmeComponents>` to watch the deep-nested path
 * `acmePayments.ui.components`. The core engine installs a PropertyTrap
 * on `window.acmePayments`, then lazily wraps each level in a Proxy as
 * properties are assigned. When `ui.components` is finally set (~800ms),
 * interception queues delivery. Default auto also keeps snapshot polling enabled.
 *
 * The status hook exposes the full lifecycle: `watching` → `ready` | `timeout` | `error`,
 * allowing the UI to show meaningful loading states instead of a blank screen.
 *
 * The generic `AcmeComponents` type parameter gives full IntelliSense
 * on the resolved value: `components.create(...)` is typed correctly.
 *
 * @param props.amount - Dollar amount in cents to display in the promo widget.
 */
function NewWayPromo({ amount }: { amount: number }) {
  const { value: components, status } = useWatchWindot<AcmeComponents>(
    'acmePayments.ui.components',
  );
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (components) {
      setDetectedAt(Date.now());
      const comp = components.create('promo', { amount, pageType: 'product' });
      if (containerRef.current) {
        comp.render('#new-way-container');
      }
      return () => { comp.destroy(); };
    }
  }, [components, amount]);

  const statusColor = status === 'ready' ? '#a6e3a1' : '#6c7086';

  return (
    <div
      data-testid="new-way"
      data-status={status}
      data-detected-at={detectedAt ?? ''}
      style={{
        padding: '1rem',
        borderRadius: '8px',
        backgroundColor: '#313244',
      }}
    >
      <div style={{ marginBottom: '0.75rem' }}>
        <p style={{ color: statusColor, margin: 0 }}>
          Status: <strong>{status}</strong>
          {status === 'watching' && ' (interception with optional polling)'}
        </p>
      </div>
      <div id="new-way-container" ref={containerRef} />
    </div>
  );
}
