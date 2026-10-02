import { join } from 'node:path';
import { chromium } from 'playwright';
import { extract, pack, repository, temporaryDirectory } from './validation.ts';

await using workspace = await temporaryDirectory('baseline');
const metadataResponse = await fetch('https://registry.npmjs.org/windotwatchr/0.2.0');
if (!metadataResponse.ok) {throw new Error(`Baseline registry metadata: ${metadataResponse.status}`);}
const metadata = await metadataResponse.json();
const response = await fetch(metadata.dist.tarball);
if (!response.ok) {throw new Error(`Baseline tarball: ${response.status}`);}
const bytes = await response.arrayBuffer();
const integrity = `sha512-${new Bun.CryptoHasher('sha512').update(bytes).digest('base64')}`;
if (integrity !== metadata.dist.integrity) {throw new Error('Published baseline integrity mismatch');}
const baselineTarball = join(workspace.path, 'baseline.tgz');
await Bun.write(baselineTarball, bytes);
await extract(baselineTarball, join(workspace.path, 'baseline'));
const candidate = await pack(workspace.path);
await extract(candidate.filename, join(workspace.path, 'candidate'));
const server = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/') {return new Response('<!doctype html><body><script type="module" src="/probe.mjs"></script>', { headers: { 'Content-Type': 'text/html' } });}
    if (path === '/probe.mjs') {return new Response(Bun.file(join(repository, 'fixtures/compatibility/runtime.mjs')), { headers: { 'Content-Type': 'text/javascript' } });}
    if (!/^\/(baseline|candidate)\/dist\/[\w.-]+\.js$/.test(path)) {return new Response('Not found', { status: 404 });}
    const file = Bun.file(join(workspace.path, path));
    return await file.exists() ? new Response(file, { headers: { 'Content-Type': 'text/javascript' } }) : new Response('Not found', { status: 404 });
  },
});
const browser = await chromium.launch({ headless: true });
try {
  async function observe(entry: string) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${server.url}?entry=${entry}`);
    await page.waitForFunction(() => document.body.dataset.results !== undefined);
    const results = await page.evaluate(() => JSON.parse(document.body.dataset.results!));
    await page.close();
    if (errors.length) {throw new Error(errors.join('\n'));}
    return results;
  }
  const [baselineResults, candidateResults] = await Promise.all([
    observe('/baseline/dist/index.js'), observe('/candidate/dist/index.js'),
  ]);
  const evidence = {
    baseline: { version: metadata.version, integrity },
    candidate: { version: candidate.version, integrity: candidate.integrity },
    bun: Bun.version, browser: browser.version(), format: 'ESM',
    results: { baseline: baselineResults, candidate: candidateResults },
  };
  await Bun.write(join(repository, 'fixtures/validation/published-baseline-comparison.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
} finally { await browser.close(); await server.stop(); }
