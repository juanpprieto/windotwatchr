import { join } from 'node:path';
import { repository } from './validation.ts';

/** Serve the production artifacts with the same base paths as GitHub Pages. */
const examples = [
  { prefix: '/windotwatchr/nextjs/', directory: 'examples/nextjs/out', spa: false },
  { prefix: '/windotwatchr/vite-react/', directory: 'examples/vite-react/dist', spa: true },
];
const server = Bun.serve({
  port: 4173, hostname: '127.0.0.1',
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const example = examples.find(candidate => path.startsWith(candidate.prefix));
    if (!example) {return new Response('Not found', { status: 404 });}
    const relative = path.slice(example.prefix.length);
    if (relative.split('/').includes('..')) {return new Response('Not found', { status: 404 });}
    const file = Bun.file(join(repository, example.directory, relative.endsWith('/') || !relative ? `${relative}index.html` : relative));
    if (await file.exists()) {return new Response(file);}
    if (!relative.endsWith('/') && await Bun.file(join(repository, example.directory, relative, 'index.html')).exists()) {
      return Response.redirect(new URL(`${path}/`, request.url), 308);
    }
    if (example.spa && !relative.includes('.')) {return new Response(Bun.file(join(repository, example.directory, 'index.html')));}
    return new Response('Not found', { status: 404 });
  },
});
process.stdout.write(`Production examples: ${server.url}windotwatchr/\n`);
