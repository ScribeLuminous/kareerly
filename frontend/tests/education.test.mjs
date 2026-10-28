import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/education.ts', import.meta.url), 'utf8');
const { EDUCATION_LEVELS, normalizeEducationLevel } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));

// Shared with supabase/tests/education_levels_tests.sql and backend/tests/test_education.py.
const CASES = [
  ['Bachelor', "Bachelor's Degree"],
  ['bachelor', "Bachelor's Degree"],
  ["Bachelor's Degree", "Bachelor's Degree"],
  ['Bachelor’s deg.', "Bachelor's Degree"],
  ['BS Computer Science', "Bachelor's Degree"],
  ['College graduate', "Bachelor's Degree"],
  ["Master's in Education", "Master's Degree"],
  ['MBA', "Master's Degree"],
  ['PhD', 'Doctorate Degree'],
  ['Doctor of Medicine', 'Doctorate Degree'],
  ['Associate in Hotel Management', 'Associate Degree'],
  ['TESDA NC II', 'Vocational / Technical'],
  ['Vocational course', 'Vocational / Technical'],
  ['some college', 'Some College'],
  ['Undergraduate', 'Some College'],
  ['Senior High School', 'High School'],
  ['high school graduate', 'High School'],
  ['Vocational / Technical', 'Vocational / Technical'],
  ['', ''],
  ['Elementary', ''],
  ['n/a', ''],
];

test('free text maps to the fixed education list', () => {
  for (const [text, expected] of CASES) assert.equal(normalizeEducationLevel(text), expected, text);
  assert.equal(normalizeEducationLevel(null), '');
});

test('every listed level maps to itself', () => {
  for (const level of EDUCATION_LEVELS) assert.equal(normalizeEducationLevel(level), level);
});

test('the account settings page offers the list instead of free text', () => {
  const page = fs.readFileSync(new URL('../src/pages/candidate/AccountSettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /EDUCATION_LEVELS\.map/);
  assert.doesNotMatch(page, /value=\{profile\.highestEducationalAttainment\} onChange=\{set\('highestEducationalAttainment'\)\} placeholder/);
});
