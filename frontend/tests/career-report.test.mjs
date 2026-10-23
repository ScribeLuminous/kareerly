import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { jsPDF } from 'jspdf';

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
const matchDisclaimer = load('../src/lib/matchDisclaimer.ts');
const reportPdf = await import(load('../src/lib/reportPdf.ts', { jspdf: import.meta.resolve('jspdf'), './matchDisclaimer': matchDisclaimer }));
const snapshotSource = readFileSync(new URL('../src/components/SnapshotStep.tsx', import.meta.url), 'utf8');

test('the preference summary shows labels for the answers given', () => {
  const items = preferences.summarizePreferences({
    industry: 'sales-marketing-customer-service', role: 'entry', setup: 'remote', salary: '35-50', skill: '',
  });
  assert.deepEqual(items, [
    { label: 'Career area', value: 'Sales, Marketing & Customer Service' },
    { label: 'Target job level', value: 'Entry-level (first job/junior)' },
    { label: 'Work setup', value: '100% Work from Home' },
    { label: 'Salary expectation', value: 'PHP 35,001 - PHP 50,000/month' },
  ]);
  // The optional answer appears only when supplied.
  const withSkill = preferences.summarizePreferences({ industry: 'technology-data', role: 'unsure', setup: 'flexible', salary: 'unsure', skill: 'SQL' });
  assert.deepEqual(withSkill.at(-1), { label: 'Skill to develop', value: 'SQL' });
  assert.equal(withSkill[1].value, "I'm not sure");
});

test('the summary follows the preferences a report was generated with', () => {
  const used = { industry: 'business-office', target_role: 'mid', role_level: 'mid', role: 'mid', work_setup: 'hybrid',
    salary: '', salary_expectation: '50-80', skill_to_develop: '' };
  assert.deepEqual(preferences.answersFromPreferencesUsed(used),
    { industry: 'business-office', role: 'mid', setup: 'hybrid', salary: '50-80', skill: '' });
  assert.equal(preferences.answersFromPreferencesUsed({}), null);
  assert.equal(preferences.answersFromPreferencesUsed(undefined), null);
  // Step 4 prefers these over the survey state, which may hold unsubmitted edits.
  assert.match(snapshotSource, /answersFromPreferencesUsed\(matchResults\.preferences_used\) \|\| state\.surveyAnswers/);
});

function content(entryCount) {
  const entry = (index) => ({
    title: `Non-Voice Support Associate ${index}`,
    location: 'Remote',
    scoreLabel: '42% • Aspiration',
    lines: ['Matched Skills: Chat Support, Order Processing', 'Missing Skills: Onboarding', 'Salary ₱30,000–₱50,000 “monthly”'],
  });
  return {
    title: 'Kareerly Career Report',
    generatedAt: new Date(2026, 8, 25),
    accessNote: 'Guest report: showing the top results only.',
    summary: [{ label: 'Fit-Now Matches', value: '0', detail: 'Best match: Not available yet' }],
    preferences: [{ label: 'Career area', value: 'Sales, Marketing & Customer Service' }],
    sections: [
      { heading: 'Aspiration Matches', emptyText: 'None', entries: Array.from({ length: entryCount }, (_, index) => entry(index + 1)) },
      { heading: 'Skill Gaps to Work On', emptyText: 'No skill gaps returned yet.', entries: [] },
    ],
  };
}

test('the PDF holds the report text and continues long reports on new pages', () => {
  const short = reportPdf.buildCareerReportPdf(jsPDF, content(2));
  const text = short.output();
  assert.match(text, /^%PDF-1\.\d/);
  for (const expected of ['Your Preferences', 'Career area: Sales, Marketing & Customer Service', 'Aspiration Matches',
    'Missing Skills: Onboarding', 'No skill gaps returned yet.', 'Guest report: showing the top results only.']) {
    assert.ok(text.includes(expected), expected);
  }
  assert.equal(short.getNumberOfPages(), 1);
  // The match-score disclaimer is printed under the title of every report.
  assert.ok(text.includes('Match percentages show how closely skills and experience line up'), 'match-score disclaimer');
  const long = reportPdf.buildCareerReportPdf(jsPDF, content(40));
  assert.ok(long.getNumberOfPages() > 2);
  assert.ok(long.output().includes(`Page ${long.getNumberOfPages()} of ${long.getNumberOfPages()}`));
});

test('PDF text uses only characters the built-in fonts can draw', () => {
  assert.equal(reportPdf.pdfSafeText('₱30,000–₱50,000 • “Remote” … 日本'), 'PHP 30,000-PHP 50,000 | "Remote" ...');
  assert.equal(reportPdf.reportFileName(new Date(2026, 8, 5)), 'kareerly-career-report-2026-09-05.pdf');
});

test('the PDF is built from the rows shown on screen, not the full result lists', () => {
  assert.match(snapshotSource, />\s*<span>\{pdfStatus === 'working' \? 'Preparing PDF…' : 'Download PDF'\}<\/span>/);
  const handler = snapshotSource.slice(snapshotSource.indexOf('const handleDownloadPdf'), snapshotSource.indexOf('return (\n    <div className="mx-auto'));
  assert.match(handler, /fitNowDescriptions\.map\(toReportEntry\)/);
  assert.match(handler, /aspirationDescriptions\.map\(toReportEntry\)/);
  assert.match(handler, /skillGaps\.map\(/);
  assert.match(handler, /learningRecommendations\.map\(/);
  assert.doesNotMatch(handler, /all_fit_now_matches|all_aspiration_matches|matchResults\.(fit_now_matches|aspiration_matches|skill_gaps|learning_recommendations)/);
});

test('line breaks inside report values do not split a PDF line', () => {
  assert.equal(reportPdf.pdfSafeText('Customer Service\nRepresentative'), 'Customer Service Representative');
});

test('the skill gap card counts every gap, not the capped list', () => {
  assert.match(snapshotSource, /skillGapSnapshotCount = resolveSnapshotCount\(matchResults\.total_skill_gap_count, fullSkillGaps\)/);
});
