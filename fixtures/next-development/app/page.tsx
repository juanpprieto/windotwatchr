'use client';

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useWatchWindot } from 'windotwatchr/react';

const globals = () => window as unknown as Record<string, unknown>;

function Probe() {
  const result = useWatchWindot('DevelopmentSDK.api', { timeout: 100, pollInterval: 10 });
  useEffect(() => {
    const trace = globals().developmentTrace as string[];
    trace.push('setup');
    return () => { trace.push('cleanup'); };
  }, []);
  useEffect(() => {
    (globals().developmentStates as string[]).push(result.status);
  }, [result.status]);
  return <output data-testid="status">{result.status}</output>;
}

export default function Page() {
  const [initialized, setInitialized] = useState(false);
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    globals().developmentTrace = [];
    globals().developmentStates = [];
    setInitialized(true);
  }, []);
  return <main>
    {initialized && mounted && <Probe />}
    <button onClick={() => { globals().DevelopmentSDK = { api: 'late API' }; }}>Assign API</button>
    <button onClick={() => {
      const raw = { api: 'queued before unmount' };
      globals().developmentLastRaw = raw;
      globals().DevelopmentSDK = raw;
      flushSync(() => setMounted(false));
    }}>Assign and unmount</button>
    <button onClick={() => setMounted(true)}>Remount</button>
  </main>;
}
