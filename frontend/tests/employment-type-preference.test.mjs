import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readCandidateFile, readCandidateSource } from './helpers/candidateSource.mjs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const survey = read('components/SurveyStep.tsx');
const options = read('lib/preferenceOptions.ts');
const auth = read('lib/auth.ts');
const api = read('lib/api.ts');
const userData = read('lib/userData.ts');
const candidate = readCandidateSource();
const migration = readFileSync(new URL('../../supabase/migrations/20261029090000_candidate_employment_type_preference.sql', import.meta.url), 'utf8');

const KEYS = ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'any'];

test('Step 3 and the Preferences page ask for an employment type', () => {
  assert.match(survey, /What type of employment are you looking for\?/);
  assert.match(survey, /options=\{employmentTypeOptions\}/);
  // Optional: new answers start at "No preference" and do not block the step.
  assert.match(survey, /employmentType: 'any'/);
  assert.doesNotMatch(survey, /isPreferencesComplete = [^\n]*employmentType/);
  assert.match(readCandidateFile('PreferencesPage.tsx'), /label="Employment type"/);
});

test('the same keys are offered, saved and allowed by the database', () => {
  for (const key of KEYS) {
    assert.ok(options.includes(`value: '${key}'`), key);
    assert.ok(migration.includes(`'${key}'`), key);
  }
  assert.match(auth, /payload\.preferred_employment_type = input\.preferredEmploymentType/);
  assert.match(candidate, /preferredEmploymentType: answers\.employmentType/);
  assert.match(candidate, /employmentType: data\.preferred_employment_type/);
  assert.match(userData, /employmentType: preferences\.employmentType/);
});

test('saving and loading still work before the migration runs', () => {
  assert.match(auth, /preferred_employment_type\/i\.test\(error\.message/);
  assert.match(candidate, /preferred_employment_type\/i\.test\(error\.message/);
});

test('every match request sends the answer', () => {
  assert.match(survey, /employment_type: answers\.employmentType/);
  assert.equal((api.match(/employment_type: payload\.preferences\.employment_type/g) || []).length, 2);
  assert.match(api, /employment_type: answers\.employmentType/);
  assert.match(candidate, /employment_type: preferencePayload\.employment_type/);
});

test('the Matches page filters by employment type and job cards show mismatches', () => {
  const matches = readCandidateFile('MatchesPage.tsx');
  assert.match(matches, /legend="Employment type"/);
  assert.match(matches, /employmentKey\(job\.employmentType \|\| ''\) !== employment/);
  const card = readCandidateFile('JobCard.tsx');
  assert.match(card, /Not what you chose: /);
  assert.match(card, /job\.preferenceMismatches/);
});
