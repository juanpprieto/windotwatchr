'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { highlight } from 'sugar-high';
import { useWindotWatchr } from 'windotwatchr/react';

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
  const ref = useRef(null);

  useEffect(() => {
    const check = () => {
      if (window?.acmePayments?.ui?.components) {
        setReady(true);
        ref.current = acmePayments.ui.components
          .create('promo', { amount, pageType: 'product' });
        ref.current.render('#container');
      } else {
        setTimeout(check, 100); // poll forever
      }
    };
    check();
    return () => { ref.current = null; };
  }, [amount]);

  if (!ready) return <p>Loading...</p>;
  return <div id="container" />;
}`;

const NEW_WAY_CODE = `function BNPLPromo({ amount }) {
  const { value: components, status } =
    useWindotWatchr('acmePayments.ui.components');

  useEffect(() => {
    if (components) {
      components
        .create('promo', { amount, pageType: 'product' })
        .render('#container');
    }
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
      <h1 style={{ color: '#cba6f7' }}>Payments — Before/After Demo</h1>
      <Link href="/" style={{ color: '#89b4fa', textDecoration: 'none' }}>&larr; Home</Link>
      <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem', maxWidth: '72ch' }}>
        Side-by-side comparison of detecting a deeply nested payment SDK
        (<code style={{ color: '#b4befe' }}>acmePayments.ui.components</code>, 3 levels deep).
        The left column uses the traditional setTimeout polling approach. The right column uses
        a single <code style={{ color: '#b4befe' }}>useWindotWatchr</code> call. Both render a
        live promo widget when the SDK is ready. The third-party script tag is loaded separately
        in the page layout and is not shown in the code snippets below.
      </p>
      <Script src="/scripts/acme-payments.js" strategy="afterInteractive" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1rem' }}>
        <div>
          <h2 style={{ color: '#f38ba8' }}>Without windotwatchr</h2>
          <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem' }}>
            You&apos;ve probably written this before. A setTimeout loop checking if the SDK exists every
            100ms, racing against a script.onload that fires before the API is actually initialized.
            It works eventually, but it&apos;s wasteful and timing-dependent.
          </p>
          <CodeSnippet code={OLD_WAY_CODE} />
          <h3 style={{ color: '#a6adc8', fontSize: '0.9rem', fontWeight: 400 }}>Live demo</h3>
          <OldWayPromo amount={4999} />
        </div>
        <div>
          <h2 style={{ color: '#a6e3a1' }}>With windotwatchr</h2>
          <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem' }}>
            windotwatchr installs a lightweight Proxy trap on the window property path. The moment
            the SDK assigns its API, your callback fires immediately. No polling loops, no race
            conditions, no wasted CPU cycles.
          </p>
          <CodeSnippet code={NEW_WAY_CODE} />
          <h3 style={{ color: '#a6adc8', fontSize: '0.9rem', fontWeight: 400 }}>Live demo</h3>
          <NewWayPromo amount={4999} />
        </div>
      </div>
    </main>
  );
}

/**
 * Traditional approach to detecting a third-party SDK.
 *
 * Demonstrates **two common failure modes** in real-world integrations:
 *
 * 1. **script.onload race condition** — The script tag fires its `load`
 *    event when the file finishes downloading, but the SDK's IIFE hasn't
 *    finished its async initialization yet. Calling the API immediately
 *    in `onload` throws because `ui.components` doesn't exist.
 *
 * 2. **setTimeout polling** — The fallback: poll `window.acmePayments.ui.components`
 *    every 100ms until it appears. Wasteful, timing-dependent, and produces
 *    unpredictable detection latency (up to one full poll interval late).
 *
 * @param props.amount - Dollar amount in cents to display in the promo widget.
 */
function OldWayPromo({ amount }: { amount: number }) {
  const [ready, setReady] = useState(false);
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.querySelector('script[src="/scripts/acme-payments.js"]');
    if (!script) return;
    const onLoad = () => {
      setScriptLoaded(true);
      const w = window as unknown as Record<string, unknown>;
      try {
        const ap = w.acmePayments as { ui?: { components?: AcmeComponents } } | undefined;
        ap!.ui!.components!.create('promo', { amount, pageType: 'product' });
      } catch {
        setApiError('acmePayments.ui is undefined');
      }
    };
    script.addEventListener('load', onLoad);
    return () => script.removeEventListener('load', onLoad);
  }, [amount]);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const w = window as unknown as Record<string, unknown>;
      const ap = w.acmePayments as { ui?: { components?: AcmeComponents } } | undefined;
      if (ap?.ui?.components) {
        if (cancelled) return;
        setReady(true);
        setDetectedAt(Date.now());
        const comp = ap.ui.components.create('promo', {
          amount,
          pageType: 'product',
        });
        if (containerRef.current) {
          comp.render('#old-way-container');
        }
      } else {
        setPollCount((c) => c + 1);
        setTimeout(check, 100);
      }
    };
    check();
    return () => {
      cancelled = true;
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
        {scriptLoaded && apiError && (
          <p
            data-testid="script-loaded-error"
            style={{
              color: '#f38ba8',
              padding: '0.5rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              margin: '0 0 0.5rem',
              backgroundColor: '#45475a',
            }}
          >
            script.onload fired — {apiError}
          </p>
        )}
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
 * windotwatchr approach — zero-polling, event-driven SDK detection.
 *
 * Uses `useWindotWatchr<AcmeComponents>` to watch the deep-nested path
 * `acmePayments.ui.components`. The core engine installs a PropertyTrap
 * on `window.acmePayments`, then lazily wraps each level in a Proxy as
 * properties are assigned. When `ui.components` is finally set (~800ms),
 * the Proxy `set` trap fires and the callback resolves immediately —
 * no polling, no race conditions, no wasted CPU cycles.
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
  const { value: components, status } = useWindotWatchr<AcmeComponents>(
    'acmePayments.ui.components',
  );
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (components && !renderedRef.current) {
      setDetectedAt(Date.now());
      renderedRef.current = true;
      const comp = components.create('promo', { amount, pageType: 'product' });
      if (containerRef.current) {
        comp.render('#new-way-container');
      }
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
          {status === 'watching' && ' (zero-polling)'}
        </p>
      </div>
      <div id="new-way-container" ref={containerRef} />
    </div>
  );
}
