/* eslint-disable no-await-in-loop -- Each compiler case owns the same isolated config. */
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright';
import { command, extract, pack, repository, temporaryDirectory } from './validation.ts';

await using workspace = await temporaryDirectory('consumers');
const artifact = await pack(workspace.path);
const consumer = join(workspace.path, 'consumer');
const modules = join(consumer, 'node_modules');
await extract(artifact.filename, join(modules, 'windotwatchr'));
const minimum = process.argv.includes('--minimum');
const profile = minimum ? 'minimum' : 'current';
await Bun.write(join(consumer, 'package.json'), JSON.stringify({ type: 'module', ...(minimum ? { dependencies: {
  react: '16.8.0', 'react-dom': '16.8.0', '@types/react': '16.8.0', '@types/react-dom': '16.8.0', typescript: '5.5.4',
} } : {}) }));
if (minimum) {await command(['bun', 'install', '--ignore-scripts'], consumer);}
else {
  await Promise.all(['react', 'react-dom', '@types'].map(name =>
    symlink(join(repository, 'node_modules', name), join(modules, name), 'dir')));
}
const cases: { name: string; passed: boolean; error?: string }[] = [];
const browsers: { engine: string; version: string }[] = [];
async function check(name: string, execute: () => Promise<unknown>) {
  try { await execute(); cases.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { cases.push({ name, passed: false, error: String(error) }); process.stderr.write(`FAIL ${name}\n${error}\n`); }
}
const compiler = join(minimum ? consumer : repository, 'node_modules/typescript/bin/tsc');
const compile = (...args: string[]) => command(['bun', compiler, ...args], consumer);
const serverRuntime = process.env.WINDOT_SERVER_RUNTIME ?? 'bun';
const serverVersion = (await command([serverRuntime, '--version'])).trim();
await check('Packed artifact contains import-only public entries and no CommonJS output', async () => {
  const metadata = await Bun.file(join(modules, 'windotwatchr/package.json')).json();
  for (const entry of Object.values(metadata.exports) as Record<string, string>[]) {
    if (!entry.import || entry.require || entry.default) {throw new Error('Expected import-only exports');}
  }
  const files = await command(['tar', '-tzf', artifact.filename]);
  if (/\.cjs(?:\n|$)/.test(files)) {throw new Error('Unexpected CommonJS output in tarball');}
});
await Bun.write(join(consumer, 'core.mts'), `import { watchWindot, waitForWindot } from 'windotwatchr';
const dispose = watchWindot('SDK', value => { void value; }); dispose(); void waitForWindot('SDK');
window.addEventListener('ww:ready', event => { const path: string = event.detail.path; void path; });`);
await Bun.write(join(consumer, 'react.mts'), `import { useWatchWindot } from 'windotwatchr/react'; void useWatchWindot;
window.addEventListener('ww:ready', event => { const path: string = event.detail.path; void path; });`);
for (const mode of ['Node16', 'NodeNext', 'Bundler']) {
  for (const source of ['core.mts', 'react.mts']) {
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      strict: true, noEmit: true, lib: ['ES2020', 'DOM'], types: [], skipLibCheck: false,
      module: mode === 'Bundler' ? 'ESNext' : mode, moduleResolution: mode,
    }, files: [source] }));
    await check(`Strict ESM declarations ${source} / ${mode}`, () => compile('-p', 'tsconfig.json'));
  }
}
await Bun.write(join(consumer, 'using.mts'), `import { watchWindot } from 'windotwatchr';
const sdk = window as unknown as Record<string, unknown>;
export async function checkScopes() {
  let calls = 0;
  const raw = {};
  {
    let ready!: () => void;
    const loaded = new Promise<void>(resolve => { ready = resolve; });
    using watcher = watchWindot('ScopedSDK', () => { calls++; ready(); }, { pollInterval: 0 });
    sdk.ScopedSDK = raw; await loaded;
  }
  if (calls !== 1 || sdk.ScopedSDK !== raw || Object.getOwnPropertyDescriptor(window, 'ScopedSDK')?.get) throw new Error('normal scope cleanup');
  {
    using watcher = watchWindot('CancelledSDK', () => { calls++; }, { pollInterval: 0 });
    sdk.CancelledSDK = raw;
  }
  await Promise.resolve();
  if (calls !== 1) throw new Error('synchronous scope must cancel queued callback');
  try {
    using watcher = watchWindot('ThrowingSDK', () => { calls++; }, { pollInterval: 0 });
    sdk.ThrowingSDK = raw; throw new Error('scope exit');
  } catch {}
  await Promise.resolve();
  if (calls !== 1 || sdk.ThrowingSDK !== raw || Object.getOwnPropertyDescriptor(window, 'ThrowingSDK')?.get) throw new Error('throwing scope cleanup');
}`);
const readme = await Bun.file(join(repository, 'README.md')).text();
const example = readme.split('### Auto-dispose with `using`')[1]!.split('```ts\n')[1]!.split('```')[0]!;
await Bun.write(join(consumer, 'readme-using.mts'), `${example}\nexport { useSDKInScope };\n`);
await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  strict: true, target: 'ES2020', module: 'NodeNext', lib: ['ES2020', 'DOM', 'ESNext.Disposable'], outDir: 'compiled',
}, files: ['using.mts', 'readme-using.mts'] }));
await check('Using syntax and unchanged README example compile', () => compile('-p', 'tsconfig.json'));
await Bun.write(join(consumer, 'browser.ts'), Bun.file(join(repository, 'fixtures/consumers/browser.ts')));
await Bun.write(join(consumer, 'react-renderer.ts'), Bun.file(join(repository, `fixtures/consumers/react-${profile}.ts`)));
await Bun.write(join(consumer, 'index.html'), '<!doctype html><html><body><script type="module" src="/browser.ts"></script></body></html>');
await mkdir(join(consumer, 'compiled'), { recursive: true });
const server = await createServer({ configFile: false, root: consumer, server: { port: 0, host: '127.0.0.1' } });
await server.listen();
try {
  const engines = process.argv.includes('--all-browsers') ? [chromium, firefox, webkit] : [chromium];
  for (const engine of engines) {
    await check(`Packed ESM ${engine.name()}: scopes, README, core/hook ownership and conflict isolation`, async () => {
      const browser = await engine.launch({ headless: true, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
      try {
        browsers.push({ engine: engine.name(), version: browser.version() });
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.goto(server.resolvedUrls!.local[0]!);
        await page.waitForFunction(() => document.body.dataset.result === 'passed');
        if (errors.length) {throw new Error(errors.join('\n'));}
      } finally {await browser.close();}
    });
  }
  await check('ESM server imports expose core and React without a window', () => command([serverRuntime, '--input-type=module', '-e',
    `const core = await import('windotwatchr'); const hooks = await import('windotwatchr/react');
     if (typeof core.watchWindot !== 'function' || typeof hooks.useWatchWindot !== 'function') throw new Error('missing entry');
     core.watchWindot('SDK', () => { throw new Error('unexpected callback'); })();
     try { await core.waitForWindot('SDK'); throw new Error('unexpected resolution'); }
     catch (error) { if (!error.message.includes('window is not available')) throw error; }`], consumer));
} finally { await server.close(); }
const evidence = {
  package: { name: artifact.name, version: artifact.version, integrity: artifact.integrity }, profile, bun: Bun.version,
  serverRuntime: { executable: serverRuntime, version: serverVersion },
  compiler: (await Bun.file(join(minimum ? consumer : repository, 'node_modules/typescript/package.json')).json()).version,
  react: (await Bun.file(join(modules, 'react/package.json')).json()).version, browsers, cases,
};
await Bun.write(join(repository, process.env.WINDOT_CONSUMER_REPORT ?? `fixtures/validation/${profile}-consumers.json`), JSON.stringify(evidence, null, 2) + '\n');
if (cases.some(result => !result.passed)) {throw new Error('Packed consumer checks failed');}
process.stdout.write(`Verified packed ${artifact.name}@${artifact.version}; ${artifact.integrity}\n`);
