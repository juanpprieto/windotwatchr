import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { repository, temporaryDirectory } from './validation.ts';

await using workspace = await temporaryDirectory('versioning');
const sourceManifest = await Bun.file(join(repository, 'package.json')).text();
const manifest = JSON.parse(sourceManifest);
const [major, minor] = manifest.version.split('.').map(Number);
const expectedVersion = `${major}.${minor + 1}.0`;
const historicalChangelog = await Bun.file(join(repository, 'CHANGELOG.md')).text();
const summary = 'Rehearse a breaking pre-1.0 release without publishing.';

await Promise.all([
  'package.json', 'bun.lock', '.changeset/config.json', 'CHANGELOG.md',
  'examples/nextjs/package.json', 'examples/vite-react/package.json', 'e2e/package.json',
].map(async path => {
  await Bun.write(join(workspace.path, path), Bun.file(join(repository, path)));
}));
await symlink(join(repository, 'node_modules'), join(workspace.path, 'node_modules'), 'dir');
await Bun.write(join(workspace.path, '.changeset/versioning-check.md'),
  `---\n"${manifest.name}": minor\n---\n\n${summary}\n`);

const child = Bun.spawn(['bun', 'run', 'version'], {
  cwd: workspace.path, stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
});
const [stdout, stderr, status] = await Promise.all([
  new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
]);
if (status !== 0) {throw new Error(`Isolated version command failed (${status})\n${stdout}${stderr}`);}

const versioned = await Bun.file(join(workspace.path, 'package.json')).json();
const changelog = await Bun.file(join(workspace.path, 'CHANGELOG.md')).text();
if (versioned.version !== expectedVersion) {throw new Error(`Expected ${expectedVersion}, received ${versioned.version}`);}
if (!changelog.includes(`## ${expectedVersion}`) || !changelog.includes(summary)) {
  throw new Error('Generated changelog omitted the new version or release summary');
}
if (!changelog.endsWith(historicalChangelog.split('\n').slice(1).join('\n'))) {
  throw new Error('Versioning changed historical changelog entries');
}
if (await Bun.file(join(workspace.path, '.changeset/versioning-check.md')).exists()) {
  throw new Error('Versioning did not consume the isolated changeset');
}
await Promise.all(['examples/nextjs/package.json', 'examples/vite-react/package.json', 'e2e/package.json'].map(async path => {
  const [versionedManifest, originalManifest] = await Promise.all([
    Bun.file(join(workspace.path, path)).text(), Bun.file(join(repository, path)).text(),
  ]);
  if (versionedManifest !== originalManifest) {
    throw new Error(`Versioning unexpectedly modified ${path}`);
  }
}));
if (await Bun.file(join(repository, 'package.json')).text() !== sourceManifest) {
  throw new Error('Isolated versioning modified the source package manifest');
}
process.stdout.write(`Verified isolated ${manifest.name} ${manifest.version} → ${expectedVersion}; source version unchanged.\n`);
