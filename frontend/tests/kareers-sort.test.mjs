import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/kareersSort.ts', import.meta.url), 'utf8');
const { sortKareers } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));

const jobs = [
  { title: 'External rich', sourceType: 'external', salaryMax: 200000, createdAt: '2026-10-20' },
  { title: 'Internal low', sourceType: 'internal', salaryMax: 20000, createdAt: '2026-09-01' },
  { title: 'External new', sourceType: 'external', salaryMax: 50000, createdAt: '2026-10-28' },
  { title: 'Internal high', sourceType: 'internal', salaryMax: 90000, createdAt: '2026-08-01' },
];
const titles = (list) => list.map((job) => job.title);

test('Kareerly jobs come before external-site jobs under every sort', () => {
  for (const order of ['newest', 'oldest', 'salary-high', 'salary-low', 'az', 'za']) {
    const sorted = sortKareers(jobs, order);
    assert.deepEqual(sorted.map((job) => job.sourceType), ['internal', 'internal', 'external', 'external'], order);
  }
});

test('the chosen order still applies within each group', () => {
  assert.deepEqual(titles(sortKareers(jobs, 'salary-high')), ['Internal high', 'Internal low', 'External rich', 'External new']);
  assert.deepEqual(titles(sortKareers(jobs, 'newest')), ['Internal low', 'Internal high', 'External new', 'External rich']);
});
