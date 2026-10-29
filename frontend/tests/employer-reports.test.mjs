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
  }).outputText.replace(/from '(\.{1,2}\/[^']+)'/g, (_match, specifier) => {
    const resolved = new URL(`${specifier}.ts`, path);
    return `from '${moduleUrl(resolved)}'`;
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
  cache.set(path, url);
  return url;
}

const reports = await import(moduleUrl(new URL('../src/pages/employer/reports.ts', import.meta.url)));

const job = (id, title, requiredSkills, status = 'open') => ({
  id, title, category: '', subcategory: '', experienceLevel: '', description: '', responsibilities: [], requiredSkills,
  niceToHaveSkills: [], workSetup: '', employmentType: '', city: '', province: '', salaryRange: '', deadline: '', status, postedDate: '',
});
const applicant = (id, jobId, status, matchedSkills, missingSkills, extra = {}) => ({
  id, publicId: `KR-${id}`, fullName: `Person ${id}`, role: '', jobId, applyTimeRankingScore: (matchedSkills.length + missingSkills.length) ? Math.round(100 * matchedSkills.length / (matchedSkills.length + missingSkills.length)) : null, matchedSkills, missingSkills,
  status, appliedDate: '2026-09-01', lastActivity: '2026-09-10T08:00:00Z', location: 'Cebu City', messageRequestState: 'none', messages: [], ...extra,
});

const jobs = [job('j1', 'Data Analyst', ['SQL', 'Python', 'Excel']), job('j2', 'Designer', ['Figma', 'UX'])];
const applications = [
  applicant('1', 'j1', 'Pending', ['SQL', 'Python', 'Excel'], []),
  applicant('2', 'j1', 'Interviewing', ['SQL'], ['Python', 'Excel']),
  applicant('3', 'j2', 'Shortlisted', ['Figma', 'UX'], []),
  applicant('4', 'j2', 'Hired', ['Figma', 'UX'], []),
  applicant('5', 'j2', 'Withdrawn', ['Figma'], ['UX']),
];

test('export rows hide name and location until Interviewing', () => {
  const rows = reports.applicantExportRows(applications, jobs);
  const pending = rows.find((row) => row.candidateId === 'KR-1');
  const interviewing = rows.find((row) => row.candidateId === 'KR-2');
  assert.equal(pending.applicant, 'KR-1');
  assert.equal(pending.fullName, '');
  assert.equal(pending.location, '');
  assert.equal(interviewing.applicant, 'Person 2');
  assert.equal(interviewing.fullName, 'Person 2');
  assert.equal(interviewing.location, 'Cebu City');
});

test('export rows carry the profile match against the job', () => {
  const [first, second] = reports.applicantExportRows(applications, jobs);
  assert.equal(first.matchPercent, 100);
  assert.equal(first.requiredFound, '3 of 3');
  assert.equal(second.matchPercent, 33);
  assert.deepEqual(second.skillsNotFound, ['Python', 'Excel']);
  assert.equal(second.jobStatus, 'Open');
  assert.equal(second.assessment, 'Not sent');
});

test('CSV quotes cells and defuses spreadsheet formulas', () => {
  assert.equal(reports.csvCell('a,b'), '"a,b"');
  assert.equal(reports.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(reports.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(reports.csvCell('@cmd'), "'@cmd");
  assert.equal(reports.csvCell(['SQL', 'Excel']), 'SQL; Excel');
  assert.equal(reports.csvCell(null), '');
  const csv = reports.applicantsCsv(reports.applicantExportRows(applications.slice(0, 1), jobs));
  const [header, row] = csv.trim().split('\r\n');
  assert.ok(header.startsWith('Job,Job status,Applicant,Candidate ID,Full name'));
  assert.ok(row.startsWith('Data Analyst,Open,KR-1,KR-1,,'));
});

test('insights rank jobs by strong matches and skip withdrawn applicants', () => {
  const insights = reports.jobMatchInsights(applications, jobs);
  assert.deepEqual(insights.map((item) => item.job.title), ['Designer', 'Data Analyst']);
  const [designer, analyst] = insights;
  assert.equal(designer.applicants, 2);
  assert.equal(designer.highMatches, 2);
  assert.equal(designer.averageMatch, 100);
  assert.equal(designer.hired, 1);
  assert.equal(analyst.averageMatch, 67);
  assert.equal(analyst.highMatchShare, 50);
  assert.deepEqual(analyst.commonGaps, [{ skill: 'Excel', count: 1 }, { skill: 'Python', count: 1 }]);
});

test('insights leave out jobs with no applicants', () => {
  const insights = reports.jobMatchInsights(applications, [...jobs, job('j3', 'Empty', ['Go'])]);
  assert.equal(insights.some((item) => item.job.id === 'j3'), false);
});

test('export file names are dated and slugged', () => {
  assert.equal(reports.exportFileName('Data Analyst (Cebu)', 'csv', new Date(2026, 8, 28)), 'kareerly-applicants-data-analyst-cebu-2026-09-28.csv');
  assert.equal(reports.exportFileName('***', 'pdf', new Date(2026, 0, 5)), 'kareerly-applicants-applicants-2026-01-05.pdf');
});

test('the PDF builds from the export content', async () => {
  const { jsPDF } = await import('jspdf');
  const rows = reports.applicantExportRows(applications, jobs);
  const doc = reports.buildApplicantReportPdf(jsPDF, {
    title: 'Applicant report', scopeLabel: 'All jobs', generatedAt: new Date(2026, 8, 28), insights: reports.jobMatchInsights(applications, jobs), rows,
  });
  const text = doc.output();
  assert.ok(doc.getNumberOfPages() >= 1);
  assert.ok(text.includes('Match insights by job'));
  assert.ok(text.includes('Person 2'));
  assert.equal(text.includes('Person 1'), false);
});
