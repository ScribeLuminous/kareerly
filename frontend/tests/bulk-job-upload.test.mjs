import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Transpiles a TS module and its relative imports into data: URLs, depth first.
// React hooks in jobDraft.ts are imported but never called here.
const cache = new Map();
function moduleUrl(file) {
  const path = new URL(file).href;
  if (cache.has(path)) return cache.get(path);
  const output = ts.transpileModule(fs.readFileSync(new URL(path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: false },
  }).outputText.replace(/from '(\.{1,2}\/[^']+)'/g, (_match, specifier) => `from '${moduleUrl(new URL(`${specifier}.ts`, path))}'`)
    .replace(/from 'react'/g, `from 'data:text/javascript,export const useMemo=()=>{};export const useSyncExternalStore=()=>{};'`);
  const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
  cache.set(path, url);
  return url;
}

const bulk = await import(moduleUrl(new URL('../src/pages/employer/bulkJobs.ts', import.meta.url)));
const TODAY = '2026-10-27';

const header = bulk.BULK_JOB_COLUMNS.map((column) => column.header).join(',');

test('the template parses into one job that is ready to post', () => {
  const result = bulk.parseBulkJobs(bulk.bulkJobTemplateCsv(TODAY), { today: TODAY });
  assert.equal(result.error, '');
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.deepEqual(row.problems, []);
  assert.equal(row.outcome, 'post');
  assert.equal(row.draft.form.city, 'Iloilo City');
  assert.equal(row.draft.form.deadline, '2026-12-15');
  assert.equal(row.draft.form.salaryRange, '18000-22000');
  assert.equal(row.draft.form.responsibilities, 'Check guests in and out\nAnswer calls and emails\nHandle billing');
  assert.deepEqual(row.draft.requiredSkills, ['Customer Service', 'Communication', 'Cash Handling']);
});

test('quoted cells keep commas, quotes and line breaks', () => {
  assert.deepEqual(bulk.parseCsv('a,"b, ""c""\nd",e\r\n1,2,3'), [['a', 'b, "c"\nd', 'e'], ['1', '2', '3']]);
  assert.deepEqual(bulk.parseCsv('﻿a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('loose spellings from spreadsheets are recognised', () => {
  const csv = [
    'Job Title,Category,Sub-category,Level,Work setup,City,Province,Minimum salary,Maximum salary,Application deadline,About the role,Responsibilities,Skills',
    'Clerk,k05,office administration,entry level,onsite,iloilo,ILOILO,"₱15,000.00","20,000",12/1/2026,Keeps records,"File papers\nAnswer calls",Filing; Typing',
  ].join('\n');
  const [row] = bulk.parseBulkJobs(csv, { today: TODAY }).rows;
  assert.deepEqual(row.problems, []);
  assert.equal(row.draft.form.category, 'Office Administration and Records');
  assert.equal(row.draft.form.subcategory, 'Office Administration');
  assert.equal(row.draft.form.experienceLevel, 'Entry-level / Fresh Graduate');
  assert.equal(row.draft.form.workSetup, 'On-site');
  assert.equal(row.draft.form.city, 'Iloilo City');
  assert.equal(row.draft.form.salaryRange, '15000-20000');
  assert.equal(row.draft.form.deadline, '2026-12-01');
  assert.deepEqual(row.draft.requiredSkills, ['Filing', 'Typing']);
});

test('unfinished rows become drafts, untitled rows are skipped', () => {
  const csv = [header, 'Only a title', ',Hospitality and Tourism'].join('\n');
  const rows = bulk.parseBulkJobs(csv, { today: TODAY }).rows;
  assert.equal(rows[0].outcome, 'draft');
  assert.match(rows[0].problems[0], /category/i);
  assert.equal(rows[1].outcome, 'skip');
  assert.equal(rows[1].rowNumber, 3);
});

test('bad values are named and a past deadline is not kept', () => {
  const csv = `job_title,category,province,city,deadline,work_setup\nX,Space travel,Cebu,Iloilo City,2026-10-01,Moon`;
  const [row] = bulk.parseBulkJobs(csv, { today: TODAY }).rows;
  assert.equal(row.outcome, 'draft');
  assert.ok(row.problems.some((problem) => problem.includes('"Space travel"')));
  assert.ok(row.problems.some((problem) => problem.includes('"Iloilo City" isn\'t listed under Cebu')));
  assert.ok(row.problems.some((problem) => problem.includes('after today')));
  assert.ok(row.problems.some((problem) => problem.includes('"Moon"')));
  assert.equal(row.draft.form.deadline, '');
});

test('duplicate titles are flagged but not blocked', () => {
  const csv = `job_title\nCook\ncook`;
  const rows = bulk.parseBulkJobs(csv, { today: TODAY, existingTitles: ['COOK'] }).rows;
  assert.ok(rows[0].warnings.includes('You already have a job with this title.'));
  assert.ok(rows[1].warnings.includes('Same title as row 2.'));
  assert.equal(rows[1].outcome, 'draft');
});

test('files without a title column or over the limit are refused', () => {
  assert.match(bulk.parseBulkJobs('name,city\nA,B', { today: TODAY }).error, /job_title/);
  assert.match(bulk.parseBulkJobs('job_title\n', { today: TODAY }).error, /no jobs/);
  const many = ['job_title', ...Array.from({ length: bulk.MAX_BULK_JOBS + 1 }, (_, i) => `Job ${i}`)].join('\n');
  assert.match(bulk.parseBulkJobs(many, { today: TODAY }).error, /up to 100/);
});

test('deadlines are read from the formats spreadsheets write', () => {
  assert.equal(bulk.parseDeadline('2026-12-31'), '2026-12-31');
  assert.equal(bulk.parseDeadline('12/31/2026'), '2026-12-31');
  assert.equal(bulk.parseDeadline('12/31/26'), '2026-12-31');
  assert.equal(bulk.parseDeadline('Dec 31, 2026'), '2026-12-31');
  assert.equal(bulk.parseDeadline('2026-02-30'), '');
  assert.equal(bulk.parseDeadline('soon'), '');
});
