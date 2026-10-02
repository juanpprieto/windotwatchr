import { resolve } from 'node:path';
import { repository } from './validation.ts';

const names = ['0.3.0-remediation-roadmap.md', '0.3.0-remediation-tasks.md', '0.3.0-contract-decisions.md', '0.3.0-validation-ledger.md'];
const [roadmap, tasks, decisions, ledger] = await Promise.all(names.map(name => Bun.file(resolve(repository, 'docs', name)).text()));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}
function anchors(text: string) {
  return new Set([
    ...Array.from(text.matchAll(/<a id="([^"]+)"/g), match => match[1]),
    ...Array.from(text.matchAll(/^#+ (.+)$/gm), match => match[1]!.toLowerCase().replace(/[^\w -]/g, '').replaceAll(' ', '-')),
  ]);
}
const texts = [roadmap!, tasks!, decisions!, ledger!];
await Promise.all(texts.map(async (text, index) => {
  assert(text.endsWith('\n') && !/^.*[ \t]+$/m.test(text), `${names[index]}: whitespace`);
  assert((text.match(/```/g)?.length ?? 0) % 2 === 0, `${names[index]}: code fence`);
  await Promise.all(Array.from(text.matchAll(/\]\(([^\s)]+)\)/g), async match => {
    const target = match[1]!;
    if (!/^(\.\.?\/|#)/.test(target)) {return;}
    const [path, fragment] = target.split('#');
    const file = Bun.file(resolve(repository, 'docs', path || names[index]!));
    assert(await file.exists(), `${names[index]}: missing link ${target}`);
    if (fragment && !/^L\d+$/.test(fragment)) {
      assert(anchors(await file.text()).has(fragment), `${names[index]}: missing anchor ${target}`);
    }
  }));
}));
const ids = Array.from(ledger!.matchAll(/^\| (T\d{2}-\d{2}) \|/gm), match => match[1]!);
assert(ids.length === 180 && new Set(ids).size === ids.length, 'Expected 180 unique seeded criteria');
for (let number = 1; number <= 27; number++) {
  const task = `t${String(number).padStart(2, '0')}`;
  const card = tasks!.split(`<a id="${task}"></a>`)[1]?.split('<a id=')[0];
  assert(card, `Missing task ${task}`);
  for (const field of ['Finding/evidence', 'Task/ownership', 'Dependencies', 'Criterion ledger', 'Acceptance criteria', 'UAT']) {
    assert(card.includes(`**${field}:**`), `${task}: missing ${field}`);
  }
  assert(ledger!.includes(`<a id="${task}"></a>`) && roadmap!.includes(`#${task})`), `${task}: missing ledger/index`);
}
function references(text: string) {
  const expanded = text.replace(/T(\d{2})–T(\d{2})/g, (_, start, end) =>
    Array.from({ length: Number(end) - Number(start) + 1 }, (_value, offset) => `T${String(Number(start) + offset).padStart(2, '0')}`).join(' '));
  return new Set(expanded.match(/T\d{2}/g));
}
const table = roadmap!.match(/\| Task \| Hard prerequisites[\s\S]*?\n\n/)![0];
const graph = new Map(Array.from(table.matchAll(/^\| (T\d{2}) \| (.*?) \|$/gm), match => [match[1]!, references(match[2]!)]));
assert(graph.size === 27, 'Missing dependency graph entries');
for (const [task, dependencies] of graph) {
  const card = tasks!.split(`<a id="${task.toLowerCase()}"></a>`)[1]!.split('<a id=')[0]!;
  const prerequisite = card.match(/\*\*Dependencies:\*\* (.*)/)![1]!.split(' (which')[0]!.split(';')[0]!.split('. ')[0]!;
  const actual = references(prerequisite);
  assert(actual.size === dependencies.size && [...actual].every(value => dependencies.has(value)), `${task}: mismatched prerequisites`);
}
const visited = new Set<string>();
function visit(task: string, active = new Set<string>()) {
  assert(!active.has(task), `Dependency cycle at ${task}`);
  if (visited.has(task)) {return;}
  const dependencies = graph.get(task);
  assert(dependencies, `Unknown prerequisite ${task}`);
  for (const dependency of dependencies) {visit(dependency, new Set([...active, task]));}
  visited.add(task);
}
for (const task of graph.keys()) {visit(task);}
for (const text of texts) {
  for (const id of text.match(/\bT\d{2}-\d{2}\b/g) ?? []) {assert(ids.includes(id), `Unknown criterion ${id}`);}
}
for (let number = 1; number <= 10; number++) {assert(decisions!.includes(`| D${String(number).padStart(2, '0')} |`), 'Missing decision');}
process.stdout.write('Validated four current documents, 27 task cards, 180 criteria, links and acyclic prerequisites.\n');
