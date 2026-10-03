import { join, dirname, resolve } from 'node:path';
import { repository } from './validation.ts';

const manifests = ['package.json', 'e2e/package.json', 'examples/nextjs/package.json', 'examples/vite-react/package.json'];
const packages = await Promise.all(manifests.map(async path => {
  const manifest = await Bun.file(join(repository, path)).json();
  const dependencies = await Promise.all(Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).map(async ([name, range]) => {
    const installed = await Bun.file(join(repository, dirname(path), 'node_modules', name, 'package.json')).json();
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`);
    if (!response.ok) {throw new Error(`${name}: registry returned ${response.status}`);}
    const latest = await response.json();
    return { name, range, installed: installed.version, latest: latest.version, current: installed.version === latest.version };
  }));
  return { manifest: path, dependencies };
}));
const evidence = { checkedAt: new Date().toISOString(), bun: Bun.version, packages };
await Bun.write(resolve(repository, process.env.WINDOT_DEPENDENCY_REPORT ?? 'fixtures/validation/dependencies.json'), JSON.stringify(evidence, null, 2) + '\n');
const outdated = packages.flatMap(workspace => workspace.dependencies.filter(dependency => !dependency.current));
if (outdated.length) {throw new Error(`Dependencies requiring refresh or disposition: ${outdated.map(dependency => dependency.name).join(', ')}`);}
process.stdout.write('All direct workspace dependencies match latest stable registry versions.\n');
