import { useEffect, useRef, useState } from 'react';
import { highlight } from 'sugar-high';
import { watchWindot, waitForWindot } from 'windotwatchr';
import { useWindotWatchr } from 'windotwatchr/react';
import type { WindotWatchrOptions } from 'windotwatchr/react';

const SCRIPTS = [
  '/scripts/acme-analytics.js',
  '/scripts/acme-payments.js',
  '/scripts/acme-pixel.js',
  '/scripts/acme-maps.js',
];

const DASHBOARD_CODE = `function SDKCard({ name, path, options }) {
  const { value, status, error } =
    useWindotWatchr(path, options);

  return (
    <div>
      <h3>{name}</h3>
      <p>Path: {path}</p>
      <p>Status: {status}</p>
      {value != null && <p>Type: {typeof value}</p>}
      {error && <p>Error: {error.message}</p>}
    </div>
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

function useScripts(srcs: string[]) {
  useEffect(() => {
    for (const src of srcs) {
      if (document.querySelector(`script[src="${src}"]`)) continue;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  }, [srcs.join(',')]);
}

export function Dashboard() {
  useScripts(SCRIPTS);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ww = { watchWindot, waitForWindot };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__ww; };
  }, []);

  return (
    <main>
      <h1 style={{ color: '#cba6f7' }}>SDK Status Dashboard</h1>
      <a href="#" style={{ color: '#89b4fa', textDecoration: 'none' }}>&larr; Home</a>
      <p style={{ color: '#a6adc8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0.5rem 0 1rem', maxWidth: '72ch' }}>
        Four third-party SDKs, four different loading patterns, one hook each. Each card below
        calls <code style={{ color: '#b4befe' }}>useWindotWatchr</code> with a single dot-notation
        path and renders the lifecycle state in real time. The same hook handles sync globals,
        property mutations, deep nesting, and incremental namespace building. The script tags that
        inject each SDK are loaded separately in the page layout and are not shown in the snippet.
      </p>
      <CodeSnippet code={DASHBOARD_CODE} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '1rem',
          marginTop: '1rem',
        }}
      >
        <SDKCard
          name="analytics"
          path="acmeDataLayer"
          testId="sdk-analytics"
          description="Sync inline global. The array exists the moment the script executes, so detection is immediate."
        />
        <SDKCard
          name="pixel"
          path="acmePx.loaded"
          testId="sdk-pixel"
          description="Two-phase init with property mutation. The stub object exists immediately, but loaded flips from false to true after 500ms. A custom ready predicate filters for the real value."
          options={{
            ready: (v: unknown) => v === true,
          }}
        />
        <SDKCard
          name="payments"
          path="acmePayments.ui.components"
          testId="sdk-payments"
          description="Deep nested path (3 levels). The stub exists at load time, but ui.components is assigned ~800ms later via incremental property assignment."
        />
        <SDKCard
          name="maps"
          path="acme.maps.Map"
          testId="sdk-maps"
          description="Incremental namespace building. The root, maps sub-namespace, and Map constructor arrive in 3 separate stages at different times."
        />
      </div>
    </main>
  );
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ready: { bg: '#313244', text: '#a6e3a1' },
  timeout: { bg: '#313244', text: '#f9e2af' },
  error: { bg: '#313244', text: '#f38ba8' },
  watching: { bg: '#313244', text: '#6c7086' },
};

function SDKCard({
  name,
  path,
  testId,
  description,
  options,
}: {
  name: string;
  path: string;
  testId: string;
  description: string;
  options?: WindotWatchrOptions;
}) {
  const { value, status, error } = useWindotWatchr(path, options);
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const recorded = useRef(false);

  useEffect(() => {
    if (status === 'ready' && !recorded.current) {
      recorded.current = true;
      setDetectedAt(Date.now());
    }
  }, [status]);

  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.watching;

  return (
    <div
      data-testid={testId}
      data-status={status}
      data-detected-at={detectedAt ?? ''}
      style={{
        padding: '1rem',
        borderRadius: '8px',
        backgroundColor: colors.bg,
      }}
    >
      <h3 style={{ margin: '0 0 0.5rem', color: '#cdd6f4' }}>{name}</h3>
      <p style={{ color: '#6c7086', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 0.75rem' }}>
        {description}
      </p>
      <p style={{ color: '#a6adc8', margin: '0.25rem 0' }}>
        Path: <code style={{ color: '#b4befe' }}>{path}</code>
      </p>
      <p style={{ margin: '0.25rem 0' }}>
        Status: <strong style={{ color: colors.text }}>{status}</strong>
      </p>
      {value != null && (
        <p style={{ color: '#a6adc8', margin: '0.25rem 0' }}>
          Type: <code style={{ color: '#b4befe' }}>{typeof value}</code>
        </p>
      )}
      {error && <p style={{ color: '#f38ba8', margin: '0.25rem 0' }}>Error: {error.message}</p>}
    </div>
  );
}
