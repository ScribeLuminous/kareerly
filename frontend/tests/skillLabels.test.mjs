import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/skillLabels.ts', import.meta.url), 'utf8');
const { cleanSkillLabel, toSkillLabels, toDisplayLabels, isInternalId } = await import(
  'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')
);

test('identifiers never reach the user', () => {
  for (const id of ['SK004', 'SK621', 'K02', 'K1']) {
    assert.equal(cleanSkillLabel(id), '', `${id} should not be shown`);
    assert.ok(isInternalId(id));
  }
  assert.deepEqual(toDisplayLabels(['SK004', 'Customer Service', 'K02', '']), ['Customer Service']);
});

test('legacy job skill IDs read as words', () => {
  assert.equal(cleanSkillLabel('SK_CRM'), 'CRM');
  assert.equal(cleanSkillLabel('SK_GOOGLE_WORKSPACE'), 'Google Workspace');
  assert.equal(cleanSkillLabel('SK_HR_ADMIN'), 'HR Admin');
});

test('names keep their own casing and known acronyms', () => {
  assert.equal(cleanSkillLabel('Customer Service'), 'Customer Service');
  assert.equal(cleanSkillLabel('sql'), 'SQL');
  assert.equal(cleanSkillLabel('PAYROLL PROCESSING'), 'Payroll Processing');
});

test('lookup wins, unresolved canonical IDs are dropped', () => {
  const lookup = new Map([['SK029', 'Customer Service']]);
  assert.deepEqual(toSkillLabels(['SK029', 'SK_CRM', 'SK999'], lookup), ['Customer Service', 'CRM']);
  assert.deepEqual(toSkillLabels(undefined, lookup), []);
});

test('legacy IDs and names keep their usual casing', () => {
  assert.equal(cleanSkillLabel('SK_FASTAPI'), 'FastAPI');
  assert.equal(cleanSkillLabel('SK_FIRST_AID'), 'First Aid');
  assert.equal(cleanSkillLabel('SK_SALES_OPS'), 'Sales Ops');
  assert.equal(cleanSkillLabel('SK_JAVASCRIPT'), 'JavaScript');
  assert.equal(cleanSkillLabel('SK_VAPT'), 'VAPT');
  // Names the backend already cased are not lowercased again.
  assert.equal(cleanSkillLabel('VAPT'), 'VAPT');
  assert.equal(cleanSkillLabel('FastAPI'), 'FastAPI');
});
