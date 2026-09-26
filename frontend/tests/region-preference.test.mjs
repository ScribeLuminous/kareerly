import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const region = await import(load('../src/lib/regionPreference.ts'));
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('three location choices, separate from work setup', () => {
  assert.deepEqual(region.locationScopeOptions.map((option) => option.label), [
    'Anywhere in the Philippines', 'Only in my current location', 'Choose a region',
  ]);
  assert.equal(region.PH_REGIONS.length, 18);
});

test('no region preference sends no filter', () => {
  for (const answers of [undefined, {}, { locationScope: 'anywhere', region: 'NCR' }]) {
    assert.deepEqual(region.locationPreferencePayload(answers, 'Makati'), { location_scope: 'anywhere', region: '', current_location: '' });
    assert.equal(region.isLocationPreferenceComplete(answers), true);
  }
});

test('a manually chosen region is sent as its code', () => {
  const answers = { locationScope: 'region', region: 'vii' };
  assert.deepEqual(region.locationPreferencePayload(answers), { location_scope: 'region', region: 'VII', current_location: '' });
  assert.equal(region.describeLocationPreference(answers), 'Region VII – Central Visayas');
});

test('the current region carries the profile location and needs a known region', () => {
  const answers = { locationScope: 'current', region: 'NCR' };
  assert.deepEqual(region.locationPreferencePayload(answers, ' Makati City '), { location_scope: 'current', region: 'NCR', current_location: 'Makati City' });
  assert.equal(region.describeLocationPreference(answers), 'National Capital Region (Metro Manila) (current region)');
  // Unknown or missing region: the candidate must choose one; nothing is guessed.
  assert.equal(region.isLocationPreferenceComplete({ locationScope: 'current', region: '' }), false);
  assert.equal(region.isLocationPreferenceComplete({ locationScope: 'region', region: 'Philippines' }), false);
  assert.equal(region.locationPreferencePayload({ locationScope: 'region', region: 'Philippines' }).region, '');
});

test('both matching requests send the region preference', () => {
  const api = read('../src/lib/api.ts');
  assert.equal((api.match(/location_scope: payload\.preferences\.location_scope \|\| 'anywhere'/g) || []).length, 2);
  assert.match(api, /\/api\/locations\/regions\?location=/);
});

test('onboarding and the dashboard ask the region question and save it', () => {
  const survey = read('../src/components/SurveyStep.tsx');
  const dashboard = read('../src/pages/Dashboard.tsx');
  for (const source of [survey, dashboard]) {
    assert.match(source, /<LocationPreferenceQuestion/);
    assert.match(source, /locationPreferencePayload\(answers, /);
    assert.match(source, /preferredLocationScope: normalizeLocationScope\(answers\.locationScope\)/);
  }
  // Work setup stays its own question.
  assert.match(survey, /label="What's your work setup preference\?"/);
  assert.match(dashboard, /<FormField label="Work Setup">/);
  assert.match(dashboard, /preferred_location_scope,preferred_region/);
});

test('an empty filtered list offers to change or remove the filter', () => {
  const notice = read('../src/components/RegionFilterNotice.tsx');
  assert.match(notice, /Change region/);
  assert.match(notice, /Show jobs anywhere in the Philippines/);
  assert.match(read('../src/pages/Dashboard.tsx'), /onRemoveRegionFilter=\{\(\) => void handlePreferencesSave\(\{ \.\.\.surveyAnswers, locationScope: 'anywhere', region: '' \}\)\}/);
  assert.match(read('../src/components/SnapshotStep.tsx'), /<RegionFilterNotice/);
});
