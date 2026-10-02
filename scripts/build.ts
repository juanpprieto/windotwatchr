/** Build browser ESM with Vite, then emit declarations with the native compiler. */
async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) {throw new Error(`Build failed: ${command.join(' ')}`);}
}
await run(['bun', '--bun', 'run', 'vite', 'build']);
await run(['bun', '--bun', 'run', 'tsc', '--project', 'tsconfig.build.json']);
