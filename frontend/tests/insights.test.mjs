import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Transpiles a TS module and its relative imports into data: URLs, depth first.
const cache = new Map();
function moduleUrl(file) {
  const path = new URL(file).href;
  if (cache.has(path)) return cache.get(path);
  const output = ts.transpileModule(fs.readFileSync(new URL(path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: false },
  }).outputText.replace(/from '(\.{1,2}\/[^']+)'/g, (_match, specifier) => `from '${moduleUrl(new URL(`${specifier}.ts`, path))}'`);
  const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
  cache.set(path, url);
  return url;
}

const dir = '../src/pages/employer/insights/';
const tiers = await import(moduleUrl(new URL(`${dir}matchTiers.ts`, import.meta.url)));
const model = await import(moduleUrl(new URL(`${dir}insightsModel.ts`, import.meta.url)));
const csv = await import(moduleUrl(new URL(`${dir}export/exportCsv.ts`, import.meta.url)));
const pdf = await import(moduleUrl(new URL(`${dir}export/exportPdf.ts`, import.meta.url)));

const job = (id, title, requiredSkills, status = 'open') => ({
  id, title, category: '', subcategory: '', experienceLevel: '', description: '', responsibilities: [], requiredSkills,
  niceToHaveSkills: [], workSetup: '', employmentType: '', city: '', province: '', salaryRange: '', deadline: '', status, postedDate: '',
});
const applicant = (id, jobId, status, matchedSkills, missingSkills, extra = {}) => ({
  id, publicId: `KR-${id}`, fullName: `Person ${id}`, role: '', jobId, applyTimeRankingScore: null, matchedSkills, missingSkills,
  status, appliedDate: '2026-09-01', lastActivity: '2026-09-10T08:00:00Z', location: 'Cebu City', messageRequestState: 'none', messages: [], ...extra,
});

test('tiers change at exactly the thresholds in matchTiers', () => {
  const { TOP_MATCH_PERCENT: top, GOOD_MATCH_PERCENT: good } = tiers;
  assert.equal(tiers.getTier(100), 'top');
  assert.equal(tiers.getTier(top), 'top');
  assert.equal(tiers.getTier(top - 1), 'good');
  assert.equal(tiers.getTier(good), 'good');
  assert.equal(tiers.getTier(good - 1), 'partial');
  assert.equal(tiers.getTier(0), 'partial');
  assert.equal(tiers.getTier(null), 'none');
  assert.equal([top, good].join(), '90,75');
});

const jobs = [
  job('a', 'Analyst', ['SQL', 'Python', 'Excel', 'BI'], 'open'),
  job('b', 'Designer', ['Figma', 'UX'], 'closed'),
  job('c', 'Coordinator', ['Ops'], 'open'),
  job('d', 'Writer', ['Copy'], 'closed'),
];
const applications = [
  applicant('1', 'a', 'Pending', ['SQL', 'Python', 'Excel', 'BI'], []), // 100
  applicant('2', 'a', 'Interviewing', ['SQL', 'Python', 'Excel'], ['BI']), // 75
  applicant('3', 'a', 'Shortlisted', ['SQL'], ['Python', 'Excel', 'BI']), // 25
  applicant('4', 'b', 'Hired', ['Figma', 'UX'], []), // 100
  applicant('5', 'c', 'Pending', [], []), // no evidence
  applicant('6', 'a', 'Withdrawn', ['SQL'], ['Python']),
];
const insights = model.buildJobInsights(applications, jobs);
const byId = (id) => insights.find((item) => item.jobId === id);

test('job insights keep no evidence as null, split levels and skip withdrawn applicants', () => {
  assert.equal(insights.some((item) => item.jobId === 'd'), false);
  const analyst = byId('a');
  assert.equal(analyst.applicants, 3);
  assert.equal(analyst.avgMatch, 67);
  assert.equal(analyst.level, 'partial');
  assert.deepEqual(analyst.counts, { top: 1, good: 1, partial: 1, none: 0 });
  assert.equal(analyst.strong, 2);
  assert.equal(analyst.advanced, 1);
  const noEvidence = byId('c');
  assert.equal(noEvidence.avgMatch, null);
  assert.equal(noEvidence.level, 'none');
  assert.deepEqual(noEvidence.counts, { top: 0, good: 0, partial: 0, none: 1 });
});

test('KPI averages ignore jobs without evidence rather than counting them as 0', () => {
  const kpis = model.buildKpis(insights);
  assert.equal(kpis.applicants, 5);
  assert.equal(kpis.jobs, 3);
  assert.equal(kpis.scored, 4);
  assert.equal(kpis.avgMatch, 75); // (100 + 75 + 25 + 100) / 4
  assert.equal(kpis.strong, 3);
  assert.equal(kpis.advanced, 2);
  assert.equal(model.buildKpis([byId('c')]).avgMatch, null);
  assert.equal(model.buildKpis([]).avgMatch, null);
});

test('jobs sort open first, then strong matches, then average, then title', () => {
  assert.deepEqual(model.sortJobs(insights).map((item) => item.jobId), ['a', 'c', 'b']);
  const tied = [
    { jobId: 'x', title: 'B', isOpen: true, strong: 1, avgMatch: 80 },
    { jobId: 'y', title: 'A', isOpen: true, strong: 1, avgMatch: 90 },
    { jobId: 'z', title: 'C', isOpen: true, strong: 1, avgMatch: null },
    { jobId: 'w', title: 'D', isOpen: false, strong: 9, avgMatch: 99 },
  ];
  assert.deepEqual(model.sortJobs(tied).map((item) => item.jobId), ['y', 'x', 'z', 'w']);
});

test('the status filter defaults to open and reads only known values', () => {
  assert.equal(model.parseStatusFilter(null), 'open');
  assert.equal(model.parseStatusFilter('bogus'), 'open');
  assert.equal(model.parseStatusFilter('closed'), 'closed');
  assert.deepEqual(model.filterJobs(insights, 'open').map((item) => item.jobId), ['a', 'c']);
  assert.deepEqual(model.filterJobs(insights, 'closed').map((item) => item.jobId), ['b']);
  assert.equal(model.filterJobs(insights, 'all').length, 3);
});

test('skill gaps rank by share, mark small samples and reserve the alert for large ones', () => {
  const many = Array.from({ length: 5 }, (_, index) => applicant(`m${index}`, 'm', 'Pending', index < 2 ? ['Go', 'Rust'] : ['Go'], index < 2 ? [] : ['Rust']));
  const solo = applicant('solo', 'q', 'Pending', [], ['Zed']);
  const set = model.buildJobInsights([...applications, ...many, solo], [...jobs, job('m', 'Engineer', ['Go', 'Rust']), job('q', 'Solo', ['Zed'])]);
  const gaps = model.topMissingSkills(set);
  const rust = gaps.find((gap) => gap.skill === 'Rust');
  assert.deepEqual([rust.missing, rust.assessed, rust.share], [3, 5, 60]);
  assert.equal(rust.smallSample, false);
  assert.equal(rust.alert, true);
  const python = gaps.find((gap) => gap.skill === 'Python');
  assert.deepEqual([python.missing, python.assessed], [1, 3]);
  assert.equal(python.smallSample, true);
  assert.equal(python.alert, false);
  // Even at 100% a small sample never alerts.
  assert.equal(gaps.find((gap) => gap.share === 100 && gap.smallSample).alert, false);
  assert.equal(gaps.some((gap) => gap.skill === 'Go'), false);
  assert.equal(model.topMissingSkills(set, 2).length, 2);
  assert.deepEqual(rust.jobTitles, ['Engineer']);
});

test('a sample is small below five applicants', () => {
  assert.equal(model.isSmallSample(4), true);
  assert.equal(model.isSmallSample(5), false);
});

test('CSV carries one aggregate row per job, with a blank average when there is no evidence', () => {
  const text = csv.insightsCsv(model.sortJobs(insights));
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], 'job_title,status,applicants,avg_match_percent,top_count,good_count,partial_count,no_evidence_count,interviewing_or_hired,top_missing_skills');
  assert.equal(lines[1], 'Analyst,Open,3,67,1,1,1,0,1,BI; Excel; Python');
  assert.equal(lines[2], 'Coordinator,Open,1,,0,0,0,1,0,');
  assert.equal(lines.length, 4);
});

test('CSV has no applicant details, escapes cells and defuses formulas', () => {
  const text = csv.insightsCsv(model.sortJobs(insights));
  for (const personal of ['Person', 'KR-', 'Cebu', '@']) assert.equal(text.includes(personal), false, personal);
  const tricky = model.buildJobInsights(
    [applicant('1', 't', 'Pending', [], ['a, "b"'])],
    [job('t', '=SUM(1,2)', ['a, "b"'])],
  );
  const row = csv.insightsCsv(tricky).trim().split('\r\n')[1];
  assert.ok(row.startsWith(`"'=SUM(1,2)",`), row);
  assert.ok(row.endsWith('"a, ""b"""'), row);
  assert.equal(csv.insightsCsv([]).trim(), csv.INSIGHTS_CSV_COLUMNS.join(','));
});

test('file names use the local date and a job slug', () => {
  const date = new Date(2026, 8, 5, 23, 59);
  assert.equal(csv.insightsFileName('pdf', date), 'kareerly-insights-2026-09-05.pdf');
  assert.equal(csv.insightsFileName('csv', date), 'kareerly-insights-2026-09-05.csv');
  assert.equal(csv.insightsFileName('csv', date, 'E-commerce Ops (Lead)'), 'kareerly-insights-e-commerce-ops-lead-2026-09-05.csv');
});

test('the PDF prints aggregates and the disclaimer on every page, and no applicant', async () => {
  const { jsPDF } = await import('jspdf');
  const many = Array.from({ length: 40 }, (_, index) => job(`p${index}`, `Long job title number ${index} for a very busy team`, ['Skill']));
  const apps = many.map((item, index) => applicant(`x${index}`, item.id, 'Pending', ['Skill'], []));
  const set = model.sortJobs(model.buildJobInsights([...applications, ...apps], [...jobs, ...many]));
  const doc = pdf.buildInsightsPdf(jsPDF, {
    employerName: 'Acme Corp', generatedAt: new Date(2026, 8, 28, 9, 30), filterLabel: 'Open jobs',
    kpis: model.buildKpis(set), jobs: set, gaps: model.topMissingSkills(set, 5),
  });
  const text = doc.output();
  assert.ok(doc.getNumberOfPages() > 1);
  assert.ok(text.includes('Kareerly Insights Report'));
  assert.ok(text.includes('Acme Corp'));
  assert.ok(text.includes('Skills applicants most often lack'));
  assert.equal((text.match(/decision-support information/g) || []).length, doc.getNumberOfPages());
  assert.equal(text.includes('Person'), false);
  assert.equal(text.includes('KR-'), false);
});
