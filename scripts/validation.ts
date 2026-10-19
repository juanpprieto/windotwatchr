import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('../', import.meta.url));

/** Bun has native process, file and hashing APIs; directory operations use fs. */
export async function command(args: string[], cwd = repository): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (status !== 0) {throw new Error(`${args.join(' ')} failed (${status})\n${stdout}${stderr}`);}
  return stdout;
}

export async function temporaryDirectory(label: string, parent = tmpdir()) {
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, `windot-${label}-`));
  return { path, async [Symbol.asyncDispose]() { await rm(path, { recursive: true, force: true }); } };
}

export async function pack(destination: string) {
  const filename = join(destination, 'candidate.tgz');
  await command(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', filename, '--quiet']);
  return inspectArtifact(filename);
}

/** Read the identity of the archive being tested, rather than the source manifest. */
export async function inspectArtifact(filename: string) {
  const bytes = await Bun.file(filename).arrayBuffer();
  const integrity = `sha512-${new Bun.CryptoHasher('sha512').update(bytes).digest('base64')}`;
  const metadata = JSON.parse(await command(['tar', '-xOf', filename, 'package/package.json']));
  return { filename, name: metadata.name, version: metadata.version, integrity };
}

export async function extract(filename: string, destination: string) {
  await mkdir(destination, { recursive: true });
  await command(['tar', '-xzf', filename, '-C', destination, '--strip-components=1']);
}
