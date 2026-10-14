import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, replacements = {}) {
  let { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  for (const [from, to] of Object.entries(replacements)) outputText = outputText.replaceAll(`'${from}'`, JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const careerAreas = load('../src/lib/careerAreas.ts');
const regionPreference = load('../src/lib/regionPreference.ts');
const preferences = await import(load('../src/lib/preferenceOptions.ts', { './careerAreas': careerAreas, './regionPreference': regionPreference }));
const mapping = JSON.parse(readFileSync(new URL('../../backend/data/career_area_skills.json', import.meta.url), 'utf8')).areas;
const surveySource = readFileSync(new URL('../src/components/SurveyStep.tsx', import.meta.url), 'utf8');
const snapshotSource = readFileSync(new URL('../src/components/SnapshotStep.tsx', import.meta.url), 'utf8');

const CONFIRMED = ['SK029']; // Customer Service: in Sales and Hospitality, in no engineering area.
const OTHER_LEVELS = ['mid', 'senior', 'unsure'];

test('an area with zero confirmed skills locks the job level to entry-level', () => {
  for (const role of ['', 'entry', ...OTHER_LEVELS]) {
    const state = preferences.jobLevelState('engineering-architecture', role, CONFIRMED, mapping);
    assert.equal(state.locked, true);
    assert.equal(state.role, 'entry', `${role || 'no level'} is reset to entry-level`);
    assert.deepEqual(state.disabledValues, OTHER_LEVELS);
  }
});

test('an area with one confirmed skill does not lock the job level', () => {
  const state = preferences.jobLevelState('sales-marketing-customer-service', 'senior', CONFIRMED, mapping);
  assert.deepEqual(state, { locked: false, role: 'senior', disabledValues: [] });
});

test('switching from a locked to an unlocked area keeps entry-level and re-enables the other levels', () => {
  // Senior chosen, then an out-of-area career: reset to entry-level.
  let role = 'senior';
  let state = preferences.jobLevelState('engineering-architecture', role, CONFIRMED, mapping);
  assert.equal(state.locked, true);
  role = state.role;
  assert.equal(role, 'entry');
  // Then an area with a confirmed skill: unlocked, entry-level still selected.
  state = preferences.jobLevelState('sales-marketing-customer-service', role, CONFIRMED, mapping);
  assert.deepEqual(state, { locked: false, role: 'entry', disabledValues: [] });
});

test('the lock is re-checked when confirmed skills change', () => {
  assert.equal(preferences.jobLevelState('engineering-architecture', 'entry', CONFIRMED, mapping).locked, true);
  // AutoCAD added in Step 2.
  assert.equal(preferences.jobLevelState('engineering-architecture', 'entry', [...CONFIRMED, 'SK680'], mapping).locked, false);
});

test('Step 3 disables the locked levels and explains the lock with a link to Step 2', () => {
  assert.match(surveySource, /jobLevelState\(answers\.industry, answers\.role, confirmedSkillIds, careerAreaSkills\)/);
  assert.match(surveySource, /disabledValues=\{jobLevel\.disabledValues\}/);
  assert.match(surveySource, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(surveySource, /disabled=\{disabled\}/);
  assert.match(surveySource, /cursor-not-allowed opacity-50/);
  assert.match(surveySource, /Locked to entry-level because you have no confirmed skills in \{getCareerAreaLabel\(answers\.industry\)\} yet\./);
  assert.match(surveySource, /setSurveyAnswers\(answers\);\s*goToStep\(2\);\s*\}\}\s*>\s*Add skills in Step 2\s*<\/button>/);
  // The card labels and the lock use the same served mapping.
  assert.match(surveySource, /confirmedSkillsInCareerArea\(option\.value, confirmedSkillIds, careerAreaSkills\)/);
  assert.match(surveySource, /loadCareerAreaSkills\(\)/);
});

test('the report says when results were limited to entry-level roles', () => {
  assert.match(snapshotSource, /jobLevelLock\?\.applied/);
  assert.match(snapshotSource, /Results are limited to entry-level roles because you have no confirmed skills in\{' '\}/);
});
