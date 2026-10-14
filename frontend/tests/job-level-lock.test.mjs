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
const served = JSON.parse(readFileSync(new URL('../../backend/data/career_area_skills.json', import.meta.url), 'utf8'));
const rules = { areas: served.areas, levelThresholds: served.level_thresholds };
const surveySource = readFileSync(new URL('../src/components/SurveyStep.tsx', import.meta.url), 'utf8');
const snapshotSource = readFileSync(new URL('../src/components/SnapshotStep.tsx', import.meta.url), 'utf8');

const AREA = 'engineering-architecture';
const NONE = ['SK029']; // Customer Service: in Sales and Hospitality, in no engineering area.
const ONE = [...NONE, 'SK680']; // + AutoCAD
const TWO = [...ONE, 'SK067']; // + Technical Drafting
const THREE = [...TWO, 'SK069']; // + Engineering Measurement
const state = (role, skills, area = AREA) => preferences.jobLevelState(area, role, skills, rules);

test('zero or one confirmed skill in the area locks to entry-level; "I\'m not sure" stays open', () => {
  for (const skills of [NONE, ONE]) {
    for (const role of ['', 'entry', 'mid', 'senior']) {
      const result = state(role, skills);
      assert.equal(result.maxLevel, 'entry');
      assert.equal(result.role, 'entry', `${role || 'no level'} becomes entry-level`);
      assert.deepEqual(result.disabledValues, ['mid', 'senior']);
    }
    assert.equal(state('unsure', skills).role, 'unsure');
  }
});

test('two confirmed skills open mid-level; senior falls to mid-level', () => {
  assert.deepEqual(state('senior', TWO), { maxLevel: 'mid', confirmedCount: 2, role: 'mid', disabledValues: ['senior'] });
  assert.equal(state('mid', TWO).role, 'mid');
  assert.equal(state('entry', TWO).role, 'entry');
  assert.equal(state('unsure', TWO).role, 'unsure');
  assert.equal(state('', TWO).role, '', 'nothing is picked for the candidate once mid-level is open');
});

test('three or more confirmed skills open every level', () => {
  assert.deepEqual(state('senior', THREE), { maxLevel: null, confirmedCount: 3, role: 'senior', disabledValues: [] });
});

test('switching from a locked to an unlocked area keeps entry-level and re-enables the other levels', () => {
  let role = state('senior', NONE).role;
  assert.equal(role, 'entry');
  // Sales, Marketing & Customer Service with Customer Service, Zendesk and HubSpot confirmed.
  const result = state(role, ['SK029', 'SK644', 'SK642'], 'sales-marketing-customer-service');
  assert.deepEqual(result, { maxLevel: null, confirmedCount: 3, role: 'entry', disabledValues: [] });
});

test('the lock is re-checked when confirmed skills change', () => {
  assert.equal(state('entry', ONE).maxLevel, 'entry');
  assert.equal(state('entry', TWO).maxLevel, 'mid');
  assert.equal(state('entry', THREE).maxLevel, null);
});

test('the note explains the lock and what unlocks the next levels', () => {
  const note = (skills) => preferences.jobLevelLockNote(state('entry', skills), 'Engineering & Architecture', rules.levelThresholds);
  assert.deepEqual(note(NONE), {
    lead: 'Locked to entry-level because you have no confirmed skills in Engineering & Architecture yet.',
    tail: 'to unlock other levels: mid-level needs 2, senior needs 3.',
  });
  assert.equal(note(ONE).lead, 'Locked to entry-level because you have only 1 confirmed skill in Engineering & Architecture.');
  assert.deepEqual(note(TWO), {
    lead: 'Senior is locked because you have 2 confirmed skills in Engineering & Architecture.',
    tail: 'to unlock it: senior needs 3.',
  });
  assert.equal(note(THREE), null);
});

test('Step 3 disables the locked levels and links the note to Step 2', () => {
  assert.match(surveySource, /jobLevelState\(answers\.industry, answers\.role, confirmedSkillIds, careerAreaRules\)/);
  assert.match(surveySource, /disabledValues=\{jobLevel\.disabledValues\}/);
  assert.match(surveySource, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(surveySource, /disabled=\{disabled\}/);
  assert.match(surveySource, /cursor-not-allowed opacity-50/);
  assert.match(surveySource, /\{jobLevelNote\.lead\}/);
  assert.match(surveySource, /setSurveyAnswers\(answers\);\s*goToStep\(2\);\s*\}\}\s*>\s*Add skills in Step 2\s*<\/button>/);
  // The card labels and the lock use the same served mapping.
  assert.match(surveySource, /confirmedSkillsInCareerArea\(option\.value, confirmedSkillIds, careerAreaSkills\)/);
  assert.match(surveySource, /careerAreaSkills=\{careerAreaRules\?\.areas \|\| \{\}\}/);
});

test('the report shows the backend\'s reason when the lock limited the results', () => {
  assert.match(snapshotSource, /jobLevelLock\?\.applied && jobLevelLock\.message/);
  assert.match(snapshotSource, /\{jobLevelLock\.message\}/);
});
