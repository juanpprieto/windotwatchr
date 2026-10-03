import { cp, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { command, extract, inspectArtifact, repository, temporaryDirectory } from './validation.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}
const filename = process.argv[process.argv.indexOf('--tarball') + 1];
assert(process.argv.includes('--tarball') && filename, 'Provide --tarball with the preserved candidate');
const artifact = await inspectArtifact(resolve(filename));
await using workspace = await temporaryDirectory('release-browser', join(repository, '.cache'));
const installed = join(workspace.path, 'installed');
await extract(artifact.filename, installed);
const errors: string[] = [];
function observe(page: Page) {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') {errors.push(message.text());} });
}
const results: Record<string, unknown> = { package: artifact, date: new Date().toISOString(), bun: Bun.version };
// A normal browser launch permits throttling; connecting without defaults also avoids Playwright's forced focus.
const chrome = Bun.spawn([chromium.executablePath(), '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=4194', `--user-data-dir=${join(workspace.path, 'chrome-profile')}`, 'about:blank'], {
  stdout: Bun.file(join(workspace.path, 'chrome.log')), stderr: Bun.file(join(workspace.path, 'chrome-errors.log')),
  env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
});
let browser: Browser | undefined;
try {
  await command(['bun', '-e', `const end=Date.now()+10000; while(Date.now()<end) { try {if((await fetch('http://127.0.0.1:4194/json/version')).ok) process.exit(0);} catch {} await Bun.sleep(100); } throw new Error('Chrome did not start');`]);
  browser = await chromium.connectOverCDP('http://127.0.0.1:4194', { noDefaults: true });
  results.browser = browser.version();
  const app = join(workspace.path, 'next');
  await cp(join(repository, 'fixtures/next-development/app'), join(app, 'app'), { recursive: true });
  await symlink(join(repository, 'examples/nextjs/node_modules'), join(app, 'node_modules'), 'dir');
  await symlink(join(repository, 'node_modules'), join(installed, 'node_modules'), 'dir');
  await Bun.write(join(app, 'package.json'), JSON.stringify({ name: 'next-development-acceptance', private: true }));
  await Bun.write(join(app, 'next.config.mjs'), `export default ${JSON.stringify({
    reactStrictMode: true, devIndicators: false,
    turbopack: { root: repository, resolveAlias: {
      windotwatchr: '../installed/dist/index.js', 'windotwatchr/react': '../installed/dist/react.js',
    } },
  })};`);
  const next = Bun.spawn(['bun', join(repository, 'examples/nextjs/node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '4193'], {
    cwd: app, stdout: Bun.file(join(workspace.path, 'next.log')), stderr: Bun.file(join(workspace.path, 'next-errors.log')),
  });
  try {
    await command(['bun', '-e', `const end=Date.now()+30000; while(Date.now()<end) { try {const r=await fetch('http://127.0.0.1:4193', { signal: AbortSignal.timeout(5000) }); if(r.ok) process.exit(0); if(r.status>=500) process.exit(1);} catch {} await Bun.sleep(1000); } throw new Error('Next dev did not start');`]);
    const page = await browser.newPage();
    observe(page);
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).developmentEvents = [];
      window.addEventListener('ww:ready', event => {
        if ((event as CustomEvent).detail.path === 'DevelopmentSDK.api') {
          ((window as unknown as Record<string, unknown>).developmentEvents as unknown[]).push((event as CustomEvent).detail);
        }
      });
    });
    await page.goto('http://127.0.0.1:4193');
    await page.waitForFunction(() => (window as unknown as Record<string, string[]>).developmentTrace?.join(',') === 'setup,cleanup,setup');
    await page.getByTestId('status').waitFor();
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'timeout');
    await page.getByRole('button', { name: 'Assign API', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'ready');
    await page.getByRole('button', { name: 'Assign and unmount' }).click();
    await page.waitForFunction(() => !document.querySelector('output'));
    await Bun.sleep(100);
    const disposed = await page.evaluate(() => {
      const globals = window as unknown as Record<string, unknown>;
      return { trace: globals.developmentTrace, states: globals.developmentStates, events: globals.developmentEvents as unknown[],
        rawPreserved: globals.DevelopmentSDK === globals.developmentLastRaw,
        descriptorRestored: !Object.getOwnPropertyDescriptor(window, 'DevelopmentSDK')?.get };
    });
    assert(disposed.rawPreserved && disposed.descriptorRestored, 'Unmount must restore the latest raw SDK');
    assert(disposed.events.length === 1, 'Assignment immediately before unmount must not emit a queued ready event');
    await page.getByRole('button', { name: 'Remount', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'ready');
    results.nextDevelopment = { disposed, remounted: true, mode: 'real Next dev / React StrictMode' };
    process.stdout.write('PASS real Next development StrictMode, timeout recovery and queued unmount\n');
    await page.close();
  } finally {
    next.kill();
    await next.exited;
    results.nextServerLog = await Bun.file(join(workspace.path, 'next.log')).text();
    results.nextServerErrors = await Bun.file(join(workspace.path, 'next-errors.log')).text();
  }

  await Bun.write(join(installed, 'index.html'), '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/background.ts"></script></body></html>');
  await Bun.write(join(installed, 'background.ts'), `import { watchWindot } from './dist/index.js';
    const samples = []; const start = performance.now();
    const raw = {}; let calls = 0; let detectedAt = null;
    const timer = setInterval(() => samples.push({ at: performance.now() - start, hidden: document.hidden }), 20);
    const stop = watchWindot('BackgroundSDK.api', () => { calls++; detectedAt = performance.now() - start; }, { strategy: 'poll', pollInterval: 20 });
    window.backgroundProbe = { samples, raw, start, get calls() { return calls; }, get detectedAt() { return detectedAt; },
      assign() { window.BackgroundSDK = raw; raw.api = 'ready'; this.assignedAt = performance.now() - start; },
      dispose() { stop(); clearInterval(timer); this.disposedAt = performance.now() - start; },
      mutate() { raw.api = 'after disposal'; } };
    document.body.dataset.ready = 'true';`);
  const server = await createServer({ configFile: false, root: installed, server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  try {
    const context = browser.contexts()[0]!;
    const page = await context.newPage();
    observe(page);
    await page.goto(server.resolvedUrls!.local[0]!);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    const foreground = await context.newPage();
    await foreground.goto('about:blank');
    await foreground.bringToFront();
    await page.waitForFunction(() => document.hidden, null, { timeout: 5000 });
    await Bun.sleep(1500);
    await page.evaluate(() => (window as any).backgroundProbe.assign());
    await Bun.sleep(2500);
    await page.bringToFront();
    await page.waitForFunction(() => (window as any).backgroundProbe.calls === 1);
    await page.evaluate(() => { (window as any).backgroundProbe.dispose(); (window as any).backgroundProbe.mutate(); });
    await Bun.sleep(100);
    const background = await page.evaluate(() => {
      const probe = (window as any).backgroundProbe;
      return { samples: probe.samples, assignedAt: probe.assignedAt, detectedAt: probe.detectedAt, disposedAt: probe.disposedAt,
        callsAfterDisposal: probe.calls, rawPreserved: (window as any).BackgroundSDK === probe.raw,
        descriptorRestored: !Object.getOwnPropertyDescriptor(window, 'BackgroundSDK')?.get };
    });
    assert(background.samples.some((sample: { hidden: boolean }) => sample.hidden), 'Smoke test must observe a genuinely hidden tab');
    assert(background.callsAfterDisposal === 1 && background.rawPreserved && background.descriptorRestored, 'Background recovery and disposal must preserve raw identity without late calls');
    results.background = { ...background, throttlingAllowed: true, timerInterval: 20,
      automationOverridesDisabled: true,
      limitation: 'Short background smoke test; no deadline or intensive-throttling guarantee.' };
  } finally { await server.close(); }
  assert(errors.length === 0, `Unexpected browser errors: ${errors.join('\n')}`);
  results.errors = errors;
  results.passed = true;
} finally {
  await browser?.close();
  chrome.kill();
  await chrome.exited;
  await Bun.write(resolve(repository, process.env.WINDOT_BROWSER_REPORT ?? 'fixtures/validation/release-browser.json'), JSON.stringify(results, null, 2) + '\n');
}
process.stdout.write(`Verified real Next development and background recovery: ${artifact.integrity}\n`);
