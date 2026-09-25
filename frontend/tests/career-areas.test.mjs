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

const areas = await import(load('../src/lib/careerAreas.ts'));
const surveySource = readFileSync(new URL('../src/components/SurveyStep.tsx', import.meta.url), 'utf8');
const backendSource = readFileSync(new URL('../../backend/app/services/matching_service.py', import.meta.url), 'utf8');

// skill_id -> skill_name from the canonical taxonomy the backend matches on.
function taxonomyLabels() {
  const text = readFileSync(new URL('../../backend/data/skills_reference.csv', import.meta.url), 'utf8');
  const labels = new Map();
  for (const line of text.split('\n').slice(1)) {
    // skill_id, category_id, skill_category, skill_subcategory, skill_name, ...; quoted fields may hold commas.
    const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((field) => field.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'));
    if (fields && /^SK\d+$/.test(fields[0])) labels.set(fields[0], fields[4]);
  }
  return labels;
}

test('Step 3 offers the thirteen career areas in order', () => {
  assert.deepEqual(areas.careerAreaOptions.map((option) => option.label), [
    'Technology & Data',
    'Business & Office',
    'Sales, Marketing & Customer Service',
    'Communications & Creative Media',
    'Education & Training',
    'Healthcare & Wellness',
    'Community & Social Services',
    'Engineering & Architecture',
    'Construction & Maintenance',
    'Manufacturing, Logistics & Transport',
    'Hospitality, Tourism & Food Services',
    'Agriculture & Environment',
    'Government, Legal & Security',
  ]);
});

test('every area skill is an existing canonical skill ID with its taxonomy name', () => {
  const labels = taxonomyLabels();
  assert.ok(labels.size > 600);
  for (const option of areas.careerAreaOptions) {
    assert.ok(option.skills.length >= 8, option.value);
    assert.equal(new Set(option.skills.map((skill) => skill.id)).size, option.skills.length, `${option.value} repeats a skill`);
    for (const skill of option.skills) {
      assert.equal(labels.get(skill.id), skill.name, `${option.value}: ${skill.id}`);
    }
  }
  // A skill may belong to several areas.
  const inAreas = (id) => areas.careerAreaOptions.filter((option) => option.skills.some((skill) => skill.id === id)).length;
  assert.ok(inAreas('SK629') >= 2, 'Microsoft Excel');
  assert.ok(inAreas('SK029') >= 2, 'Customer Service');
});

test('the frontend areas are the backend areas', () => {
  for (const option of areas.careerAreaOptions) {
    assert.match(backendSource, new RegExp(`"${option.value}": "${option.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  for (const legacy of areas.legacyCareerAreaOptions) {
    for (const covered of legacy.covers) assert.ok(areas.careerAreaLabels[covered], covered);
    assert.match(backendSource, new RegExp(`"${legacy.value}": \\(`));
  }
});

test('a few examples describe each area', () => {
  assert.deepEqual(areas.careerAreaSkillExamples('sales-marketing-customer-service'),
    ['Customer Service', 'Sales Techniques', 'Digital Marketing', 'HubSpot']);
  assert.deepEqual(areas.careerAreaSkillExamples('unknown-area'), []);
});

test('only skills the candidate confirmed are shown as theirs', () => {
  const confirmed = ['SK645', 'sk642', 'SK655', null, 'SK999'];
  assert.deepEqual(areas.confirmedSkillsInCareerArea('sales-marketing-customer-service', confirmed), ['HubSpot', 'Help Scout']);
  assert.deepEqual(areas.confirmedSkillsInCareerArea('healthcare-wellness', confirmed), ['Patient Coordination']);
  assert.deepEqual(areas.confirmedSkillsInCareerArea('agriculture-environment', confirmed), []);
});

test('saved preferences keep their meaning', () => {
  // Current values and labels (the dashboard saves the label).
  assert.equal(areas.normalizeCareerAreaValue('healthcare-wellness'), 'healthcare-wellness');
  assert.equal(areas.normalizeCareerAreaValue('Manufacturing, Logistics & Transport'), 'manufacturing-logistics-transport');
  // Legacy broad areas stay selected, readable and flagged.
  for (const [value, label] of [
    ['engineering-trades-operations', 'Engineering, Trades & Operations'],
    ['education-health-community', 'Education, Health & Community'],
  ]) {
    assert.equal(areas.normalizeCareerAreaValue(value), value);
    assert.equal(areas.normalizeCareerAreaValue(label), value);
    assert.equal(areas.getCareerAreaLabel(value), label);
    assert.ok(areas.isLegacyCareerArea(label));
  }
  assert.equal(areas.normalizeCareerAreaValue('engineering-manufacturing-agriculture-logistics'), 'engineering-trades-operations');
  assert.equal(areas.normalizeCareerAreaValue('tech'), 'technology-data');
  assert.equal(areas.isLegacyCareerArea('technology-data'), false);
});

test('choosing an area never changes the skills sent for matching', () => {
  // The match request sends the Step 2 skills; the area is only a preference.
  assert.match(surveySource, /candidate_skill_ids: finalCandidateSkillIds,/);
  assert.match(surveySource, /confirmed_skills: selectedSkills,/);
  assert.doesNotMatch(surveySource, /setSelectedSkills\([^)]*careerArea/);
  assert.match(surveySource, /Your matches use only the skills you confirmed in Step 2\./);
});
