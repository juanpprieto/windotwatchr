import { dirname, resolve } from 'node:path';
import { command, inspectArtifact } from './validation.ts';

const manifestPath = process.argv[2];
if (!manifestPath) {throw new Error('Provide the candidate evidence manifest');}
const manifest = await Bun.file(resolve(manifestPath)).json();
const manifestDirectory = dirname(resolve(manifestPath));
async function requireEvidence(path: unknown, label: string) {
  if (typeof path !== 'string' || !path || !await Bun.file(resolve(manifestDirectory, path)).exists()) {
    throw new Error(`${label} evidence file is missing; return to validation`);
  }
}
const requiredChecks = ['frozen-install', 'typecheck', 'lint', 'docs', 'versioning', 'dependencies', 'audit',
  'browser-tests', 'current-consumers', 'minimum-consumers', 'production-examples', 'production-e2e', 'release-browser'];
function requireMatch(record: { sourceSha?: string; integrity?: string } | undefined, label: string) {
  if (!record || record.sourceSha !== manifest.sourceSha || record.integrity !== manifest.integrity) {
    throw new Error(`${label} does not identify this source SHA and tarball digest; return to validation`);
  }
}
if (!/^[a-f0-9]{40}$/.test(manifest.sourceSha ?? '')) {throw new Error('Missing full candidate source SHA');}
const head = (await command(['git', 'rev-parse', 'HEAD'])).trim();
if (head !== manifest.sourceSha || (await command(['git', 'status', '--porcelain'])).trim()) {
  throw new Error('Checkout differs from the clean candidate source SHA; return to validation');
}
const artifact = await inspectArtifact(resolve(manifestDirectory, manifest.tarball));
if (artifact.name !== 'windotwatchr' || artifact.version !== '0.3.0' || artifact.integrity !== manifest.integrity) {
  throw new Error('Tarball identity differs from the candidate; return to validation');
}
await Promise.all(requiredChecks.map(async name => {
  const check = manifest.checks?.[name];
  requireMatch(check, name);
  if (check.status !== 'passed' || !check.evidence) {throw new Error(`${name} lacks passing evidence; return to validation`);}
  await requireEvidence(check.evidence, name);
}));
requireMatch(manifest.review, 'Independent approval');
if (manifest.review.status !== 'approved' || !manifest.review.reviewer || !manifest.implementer
  || manifest.review.reviewer === manifest.implementer || !manifest.review.evidence) {
  throw new Error('Independent approval is missing; return to review');
}
await requireEvidence(manifest.review.evidence, 'Independent approval');
process.stdout.write(`Candidate verification passed: ${manifest.sourceSha}\n${artifact.integrity}\nPublication remains disabled and requires separate authorization.\n`);
