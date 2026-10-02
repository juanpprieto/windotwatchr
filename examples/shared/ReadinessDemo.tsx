'use client';

import { useEffect, useRef, useState } from 'react';
import { watchWindot } from 'windotwatchr';

interface Components {
  initialized: boolean;
  create: (amount: number) => string;
}

type DemoWindow = Window & {
  readinessPayments?: { ui?: { components: Components } };
};

type Phase = 'idle' | 'loading' | 'script' | 'api' | 'initialized';
type WatcherStatus = 'watching' | 'ready' | 'cancelled' | 'error';
interface TimelineEntry { sequence: number; elapsed: number; message: string }

const path = 'readinessPayments.ui.components';
const canUseComponents = (value: unknown): value is Components => {
  const components = value as Partial<Components> | null | undefined;
  return components?.initialized === true && typeof components.create === 'function';
};
const snippet = `function canUseComponents(value: unknown): value is Components {
  const api = value as Partial<Components> | null | undefined;
  return api?.initialized === true
    && typeof api.create === 'function';
}

const dispose = watchWindot<Components>(
  'readinessPayments.ui.components',
  components => renderPromo(components.create(4999)),
  {
    ready: canUseComponents,
    once: true,
    strategy: 'auto',
    pollInterval: 100,
  },
);

// On unmount or cancellation:
dispose();`;

/** A fresh mounted run owns its script, SDK root, watcher and event listener. */
export function ReadinessDemo() {
  const [run, setRun] = useState(0);
  return <ReadinessRun key={run} replay={() => setRun(previous => previous + 1)} />;
}

function ReadinessRun({ replay }: { replay: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<WatcherStatus>('watching');
  const [deliveries, setDeliveries] = useState(0);
  const [promo, setPromo] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const startedAt = useRef(0);
  const sequence = useRef(0);
  const stop = useRef<(() => void) | null>(null);
  const script = useRef<HTMLScriptElement | null>(null);
  const scriptURL = useRef<string | null>(null);
  const scriptEvents = useRef<AbortController | null>(null);

  function record(message: string) {
    const entry = { sequence: ++sequence.current, elapsed: performance.now() - startedAt.current, message };
    setEntries(previous => [...previous, entry]);
  }

  useEffect(() => {
    startedAt.current = performance.now();
    sequence.current = 0;
    setEntries([{ sequence: 0, elapsed: 0, message: 'Watcher registered; waiting for a usable API.' }]);
    const onReady = (event: WindowEventMap['ww:ready']) => {
      if (event.detail.path === path && event.detail.id === 'guided-payment-readiness') {
        record('Readiness predicate passed (ww:ready).');
      }
    };
    window.addEventListener('ww:ready', onReady);
    stop.current = watchWindot<Components>(path, components => {
      record('Callback delivered; the API rendered the promo.');
      setDeliveries(previous => previous + 1);
      setPromo(components.create(4999));
      setStatus('ready');
    }, { ready: canUseComponents, once: true, strategy: 'auto', pollInterval: 100, correlationId: 'guided-payment-readiness' });

    return () => {
      stop.current?.();
      window.removeEventListener('ww:ready', onReady);
      scriptEvents.current?.abort();
      script.current?.remove();
      if (scriptURL.current) { URL.revokeObjectURL(scriptURL.current); }
      delete (window as DemoWindow).readinessPayments;
    };
  }, []);

  function loadScript() {
    setPhase('loading');
    record('Loading the mock payment script.');
    // A removed script must not recreate its SDK after navigation or replay.
    const source = 'if (document.currentScript?.isConnected) window.readinessPayments = {};';
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    scriptURL.current = url;
    const element = document.createElement('script');
    const controller = new AbortController();
    scriptEvents.current = controller;
    script.current = element;
    element.src = url;
    element.addEventListener('load', () => {
      controller.abort();
      URL.revokeObjectURL(url);
      scriptURL.current = null;
      setPhase('script');
      record('Script load event fired. The SDK stub exists; the nested API is still absent.');
    }, { once: true, signal: controller.signal });
    element.addEventListener('error', () => {
      controller.abort();
      URL.revokeObjectURL(url);
      scriptURL.current = null;
      stop.current?.();
      setStatus('error');
      record('The mock script failed to load. Replay to start a fresh run.');
    }, { once: true, signal: controller.signal });
    document.head.appendChild(element);
  }

  function exposeAPI() {
    (window as DemoWindow).readinessPayments!.ui = {
      components: {
        initialized: false,
        create(amount) {
          if (!this.initialized) { throw new Error('Payment API is not initialized.'); }
          const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
          return `Payment promo for ${price}`;
        },
      },
    };
    setPhase('api');
    record('Nested API exposed with initialized = false. No callback yet.');
  }

  function initializeAPI() {
    record('SDK sets initialized = true.');
    (window as DemoWindow).readinessPayments!.ui!.components.initialized = true;
    setPhase('initialized');
  }

  function cancel() {
    stop.current?.();
    setStatus('cancelled');
    record('Watcher disposed. Continue initializing the SDK: it must not deliver a callback.');
  }

  const scriptLoaded = ['script', 'api', 'initialized'].includes(phase);
  const apiExposed = ['api', 'initialized'].includes(phase);
  const explanation = status === 'cancelled'
    ? 'Cancellation stops the watcher. The SDK can initialize independently; callback count stays at zero.'
    : status === 'error'
      ? 'The script could not load. Use Replay to try a fresh run.'
      : phase === 'idle'
        ? 'Start by loading the script. The watcher is already registered.'
        : phase === 'loading'
          ? 'Waiting for the real script load event.'
          : phase === 'script'
            ? 'The script has loaded, but ui.components does not exist yet. Expose the API next.'
            : phase === 'api'
              ? 'The API exists, but initialized is false. Existence alone would declare it ready too early.'
              : status === 'ready'
                ? 'The predicate passed. The callback used the API and the once watcher disposed itself.'
                : 'The SDK is initialized. Waiting for the next readiness check.';

  return (
    <section className="readiness-demo" aria-labelledby="readiness-title" data-testid="readiness-demo">
      <header className="readiness-intro">
        <p className="readiness-eyebrow">Try it, one step at a time</p>
        <h2 id="readiness-title">The script loaded.<br />Can you use the API yet?</h2>
        <p>A downloaded script can expose a stub long before its API is usable. You control each stage of this mock payment SDK.</p>
      </header>

      <div className="readiness-controls">
        <button type="button" className="readiness-primary" onClick={loadScript} disabled={phase !== 'idle'}>1. Load script</button>
        <button type="button" onClick={exposeAPI} disabled={phase !== 'script'}>2. Expose API</button>
        <button type="button" onClick={initializeAPI} disabled={phase !== 'api'}>3. Initialize API</button>
        <button type="button" onClick={cancel} disabled={status !== 'watching'}>Cancel watcher</button>
        <button type="button" onClick={replay}>Replay</button>
      </div>

      <div className="readiness-experiment">
        <div>
          <ol className="readiness-stages" aria-label="SDK initialization stages">
            <li data-complete={scriptLoaded}><span>Script loaded</span><strong>{scriptLoaded ? 'Yes' : 'Not yet'}</strong></li>
            <li data-complete={apiExposed}><span>Nested API exists</span><strong>{apiExposed ? 'Yes' : 'Not yet'}</strong></li>
            <li data-complete={phase === 'initialized'}><span>API initialized</span><strong>{phase === 'initialized' ? 'Yes' : 'Not yet'}</strong></li>
          </ol>
          <p className="readiness-explanation" aria-live="polite" data-testid="readiness-explanation">{explanation}</p>
        </div>
        <div className="readiness-result" data-testid="readiness-result" data-status={status}>
          <div className="readiness-result-label"><span>What your app receives</span><strong>{status}</strong></div>
          <p className="readiness-promo" aria-live="polite">{promo ?? 'The promo waits for a usable API.'}</p>
          <p>Callback count: <strong data-testid="readiness-callback-count">{deliveries}</strong></p>
          <p className="readiness-result-note">This run uses <code>once: true</code> and default <code>auto</code> with 100ms snapshots. Polling rechecks the API’s internal flag; interception observes assignments to the watched path.</p>
        </div>
      </div>

      <details className="readiness-details" open>
        <summary>What happened</summary>
        <ol className="readiness-timeline" data-testid="readiness-timeline">
          {entries.map(entry => <li key={entry.sequence}><span className="readiness-elapsed">+{(entry.elapsed / 1000).toFixed(2)}s</span><span>{entry.message}</span></li>)}
        </ol>
      </details>
      <details className="readiness-details">
        <summary>Show the watcher code</summary>
        <p><code>Components</code> is the mock SDK type; <code>renderPromo</code> updates your UI. The predicate is pure and checks this SDK’s explicit initialization flag. Prefer a vendor’s documented readiness promise or callback when available.</p>
        <pre><code>{snippet}</code></pre>
      </details>
    </section>
  );
}
