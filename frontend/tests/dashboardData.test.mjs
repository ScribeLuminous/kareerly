import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
async function loadUtility(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

// Exercise the real page mappers and rendering without an authenticated database session.
const React = require('react');
const deps = {
  ...React,
  ...require('@fortawesome/free-solid-svg-icons'),
  ...require('@fortawesome/react-fontawesome'),
  ...await loadUtility('../src/lib/matchScoring.ts'),
  ...await loadUtility('../src/lib/uiData.ts'),
  ...await loadUtility('../src/lib/jobDescription.ts'),
  React,
};
function importedNames(parsed) {
  return parsed.statements.filter(ts.isImportDeclaration).flatMap((node) => {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return [];
    const names = clause.name ? [clause.name.text] : [];
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text));
    if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
    return names;
  });
}

// Transpile one page module with its imports resolved from `deps` (earlier
// modules' exports are added to `deps` so later modules can use them).
async function loadModule(path, exposed = '', defaultName = '') {
  globalThis.__dashboardDataTestDeps = deps;
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = importedNames(parsed);
  const declarations = [...new Set(['React', ...names])].map((name) => `const ${name} = globalThis.__dashboardDataTestDeps.${name};`).join('\n');
  const { outputText } = ts.transpileModule(`${declarations}\n${source}\n${exposed ? `export { ${exposed} };` : ''}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React },
    transformers: { before: [() => (node) => ts.factory.updateSourceFile(node, node.statements.filter((statement) => !ts.isImportDeclaration(statement)))] },
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  delete globalThis.__dashboardDataTestDeps;
  Object.assign(deps, module);
  if (defaultName) deps[defaultName] = module.default;
  return module;
}

async function loadPage(paths, exposed) {
  const loaded = {};
  for (const entry of paths) {
    const [path, defaultName] = Array.isArray(entry) ? entry : [entry, ''];
    Object.assign(loaded, await loadModule(path, path.endsWith('Dashboard.tsx') ? exposed : '', defaultName));
  }
  return loaded;
}

const candidate = (name) => `../src/pages/candidate/${name}`;
const ui = (name) => `../src/components/ui/${name}`;
const page = await loadPage([
  candidate('model.ts'),
  '../src/lib/matchFeedback.ts',
  ['../src/components/MatchFeedbackControls.tsx', 'MatchFeedbackControls'],
  ui('hooks.ts'),
  ui('controls.tsx'),
  ui('feedback.tsx'),
  [ui('Modal.tsx'), 'Modal'],
  candidate('common.tsx'),
  candidate('JobCard.tsx'),
  candidate('HomePage.tsx'),
  candidate('JobDetailModal.tsx'),
]);
const employerPage = await loadPage(['../src/pages/EmployerDashboard.tsx'], 'toEmployerJob, toCandidateApplication, emptyJobForm, getMatchBucket');

test('unmatched job listings do not invent work setup, level, employer, or missing skills', () => {
  const job = page.mapAvailableJob({ job_id: 'role-1', job_title: 'Senior Data Engineer', required_skills: ['SQL'] });
  assert.equal(job.location, 'Location not specified');
  assert.equal(job.setup, 'Work setup not specified');
  assert.equal(job.company, 'Unknown company');
  assert.equal(job.jobLevel, 'Not Specified');
  assert.deepEqual(job.missingSkills, []);
  assert.equal(page.getMatchBadgeLabel(job), 'Match not available');
  const actual = page.mapAvailableJob({ job_id: 'role-2', job_title: 'Role', location: 'Cebu', work_setup: 'Hybrid', experience_level_required: 'Senior', company_name: 'Employer', salary_range_monthly_php: 'PHP 50,000' });
  assert.equal(actual.location, 'Cebu');
  assert.equal(actual.setup, 'Hybrid');
  assert.equal(actual.jobLevel, 'Senior');
  assert.equal(actual.company, 'Employer');
  assert.equal(actual.salary, 'PHP 50,000');
});

test('matched roles preserve unknown scores and use explicit job metadata', () => {
  const unknown = page.mapRunMatch({ job_id: 'role-1', job_title: 'Data Analyst', location: 'Manila' }, 'fit-now');
  assert.equal(unknown.setup, 'Work setup not specified');
  assert.equal(unknown.jobLevel, 'Not Specified');
  assert.equal(page.getMatchBadgeLabel(unknown), 'Match not available');
  const actual = page.mapRunMatch({ job_id: 'role-2', job_title: 'Role', match_percentage: 0, work_setup: 'Remote', job_level: 'Junior' }, 'fit-now');
  assert.equal(actual.setup, 'Remote');
  assert.equal(actual.jobLevel, 'Junior');
  assert.match(page.getMatchBadgeLabel(actual), /^0%/);
});

test('saved applications retain their original score rather than a later match result', () => {
  const currentJob = { id: 'role-1', jobSource: 'internal', matchScore: 95, title: 'Role', company: 'Employer' };
  const row = { id: 'app-1', job_id: 'role-1', job_source: 'internal', status: 'pending' };
  const missing = page.mapApplicationRow(row, [currentJob]);
  assert.equal(missing.matchScore, null);
  assert.equal(missing.dateApplied, '');
  assert.equal(page.mapApplicationRow({ ...row, match_score: 0 }, [currentJob]).matchScore, 0);
});

test('dashboard empty state renders placeholders without invented activity', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(page.HomePage, {
    isLoading: false,
    nextSteps: [{ id: 'resume', title: 'Upload your resume', detail: 'Kareerly reads your skills and finds jobs that fit.', actionLabel: 'Upload resume', onAction: noop }],
    fitNowCount: 0, aspirationCount: 0, topMatches: [], getApplicationStatus: () => null, onOpenJob: noop, onOpenMatches: noop,
    topGaps: [], gapCount: 0, onOpenSkills: noop,
    recentApplications: [], applicationLoadStatus: 'loading', activeApplicationCount: 0, onOpenApplications: noop,
    profileTasks: [{ label: 'Upload your resume', done: false, onAction: noop }],
  }));
  assert.match(html, /Loading applications/);
  assert.match(html, /Upload your resume/);
  assert.doesNotMatch(html, /hours ago|Yesterday|IAMCompany|8 applications|Fit Now/);
});


test('skill gaps and learning resources preserve unavailable counts, costs, and credentials', () => {
  const gap = page.mapRunGap({ skill_name: 'SQL', severity: 'Critical' });
  assert.equal(gap.affectedCount, null);
  assert.equal(gap.severity, 'Critical');
  const course = page.mapRunLearningRecommendation({ resource_id: 'course-1', title: 'Course' });
  assert.equal(course.isFree, false);
  assert.equal(course.fees, 'Unknown');
  assert.equal(course.credentialLabel, 'Credential not specified');
  const free = page.mapRunLearningRecommendation({ resource_id: 'course-2', title: 'Course', cost_type: 'Free' });
  assert.equal(free.isFree, true);
  assert.equal(free.fees, 'Free');
});

test('unmatched job detail rendering does not claim aspiration or low confidence', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(page.JobDetailModal, {
    job: page.mapAvailableJob({ job_id: 'role-1', job_title: 'Role' }),
    application: null, courses: [], isSaved: false,
    onClose: noop, onApply: noop, onWithdraw: noop, onSave: noop,
  }));
  assert.match(html, /Match not available/);
  assert.match(html, /Confidence: Not available/);
  assert.doesNotMatch(html, /0%|>Aspiration<|Confidence: Low/);
});


test('employer applicants without saved scores stay outside scored match groups', () => {
  const row = { id: 'app-1', job_id: 'role-1', status: 'pending' };
  const missing = employerPage.toCandidateApplication(row, []);
  assert.equal(missing.hasMatchScore, false);
  assert.equal(missing.appliedDate, '');
  assert.equal(employerPage.getMatchBucket(missing.matchPercent, missing.hasMatchScore), 'unknown');
  const zero = employerPage.toCandidateApplication({ ...row, match_score: 0 }, []);
  assert.equal(zero.hasMatchScore, true);
  assert.equal(employerPage.getMatchBucket(zero.matchPercent, zero.hasMatchScore), 'partial');
});

test('employer job metadata preserves employment type and unavailable dates', () => {
  assert.equal(employerPage.emptyJobForm.employmentType, '');
  const missing = employerPage.toEmployerJob({ job_id: 'role-1', job_title: 'Role' });
  assert.equal(missing.employmentType, '');
  assert.equal(missing.postedDate, '');
  const actual = employerPage.toEmployerJob({ job_id: 'role-2', job_title: 'Role', employment_type: 'Part-time', created_at: '2026-09-15T10:00:00Z' });
  assert.equal(actual.employmentType, 'Part-time');
  assert.equal(actual.postedDate, '2026-09-15');
});
