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
  ...await loadUtility('../src/lib/phProvinces.ts'),
  React,
};
// Names a module re-exports from elsewhere (`export { A } from './x'`).
function reexportedNames(parsed) {
  return parsed.statements
    .filter((node) => ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause))
    .flatMap((node) => node.exportClause.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text));
}

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
  const reexports = reexportedNames(parsed);
  const names = [...importedNames(parsed), ...reexports];
  const declarations = [...new Set(['React', ...names])].map((name) => `const ${name} = globalThis.__dashboardDataTestDeps.${name};`).join('\n');
  const exportList = [exposed, reexports.join(', ')].filter(Boolean).join(', ');
  const { outputText } = ts.transpileModule(`${declarations}\n${source}\n${exportList ? `export { ${exportList} };` : ''}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React },
    transformers: { before: [() => (node) => ts.factory.updateSourceFile(node, node.statements.filter((statement) => !ts.isImportDeclaration(statement) && !(ts.isExportDeclaration(statement) && statement.moduleSpecifier)))] },
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
  ui('page.tsx'),
  candidate('common.tsx'),
  candidate('JobCard.tsx'),
  candidate('HomePage.tsx'),
  candidate('JobDetailModal.tsx'),
]);
const { renderToStaticMarkup } = require('react-dom/server');
const employerPage = await loadPage([
  '../src/pages/employer/model.ts',
  '../src/pages/employer/evaluation.ts',
  '../src/pages/employer/EvaluationPanels.tsx',
  '../src/pages/employer/ApplicantRow.tsx',
]);

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


test('employer applications keep the apply-time ranking score apart from profile match', () => {
  const row = { id: 'app-1', job_id: 'role-1', status: 'pending' };
  const missing = employerPage.toCandidateApplication(row, []);
  assert.equal(missing.applyTimeRankingScore, null);
  assert.equal(missing.appliedDate, '');
  assert.equal(missing.lastActivity, '');
  const zero = employerPage.toCandidateApplication({ ...row, match_score: 0 }, []);
  assert.equal(zero.applyTimeRankingScore, 0);
  const active = employerPage.toCandidateApplication({ ...row, applied_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-03T00:00:00Z' }, [], [{ id: 'm', application_id: 'app-1', sender_role: 'employer', message_kind: 'message', message_text: 'Hi', created_at: '2026-09-05T00:00:00Z' }]);
  assert.equal(active.lastActivity, '2026-09-05T00:00:00Z');
});

// The UI case from the audit: "5 of 6 skills" shown next to "57% match". The 57%
// was the candidate-side composite (0.45 text similarity + 0.45 required skills
// + 0.10 preferred skills), whose similarity part is not stored. Profile match
// is now the explainable required-skill coverage alone.
test('profile match is the share of the job required skills found in the application', () => {
  const application = { matchedSkills: ['SQL', 'excel', 'Python', 'Tableau', 'Statistics'], missingSkills: ['R'] };
  const job = { requiredSkills: ['SQL', 'Excel', 'Python', 'Tableau', 'Statistics', 'R'] };
  const match = employerPage.profileMatch(application, job);
  assert.equal(match.percent, 83);
  assert.deepEqual(match.notFound, ['R']);
  assert.equal(employerPage.profileMatchLabel(match), '5 of 6 required skills');
  // Skills added to the job after the application are not found, not guessed.
  const grown = employerPage.profileMatch(application, { requiredSkills: [...job.requiredSkills, 'dbt', 'Airflow'] });
  assert.equal(grown.percent, 63);
  assert.deepEqual(grown.notFound, ['R', 'dbt', 'Airflow']);
  // Without the job, fall back to the lists recorded at apply time.
  assert.equal(employerPage.profileMatch(application, null).percent, 83);
  // No evidence recorded: no number, rather than 0%.
  const empty = employerPage.profileMatch({ matchedSkills: [], missingSkills: [] }, job);
  assert.equal(empty.percent, null);
  assert.equal(employerPage.profileMatchLabel(empty), 'No skill evidence recorded');
  assert.deepEqual(empty.notFound, []);
  assert.equal(employerPage.profileMatch(application, { requiredSkills: [] }).percent, 83);
});

test('rubric drafts are validated and serialised for the database', () => {
  const starter = employerPage.starterRubric({ requiredSkills: ['SQL', 'Excel'], responsibilities: ['Build weekly sales reports'] });
  assert.equal(starter.length, 3);
  assert.equal(employerPage.validateRubricDraft(starter), null);
  assert.match(starter[0].question, /SQL/);
  assert.equal(employerPage.validateRubricDraft([]), 'Add at least one criterion.');
  assert.match(employerPage.validateRubricDraft([{ ...starter[0], name: ' ' }]), /needs a name/);
  assert.match(employerPage.validateRubricDraft([starter[0], { ...starter[1], name: 'sql' }]), /appears twice/);
  assert.match(employerPage.validateRubricDraft([{ ...starter[0], anchors: ['a', '', 'c', 'd'] }]), /four rating anchors/);
  assert.match(employerPage.validateRubricDraft(starter.map((item) => ({ ...item, isRequired: false }))), /at least one criterion as required/);
  const payload = employerPage.rubricPayload([{ ...starter[0], name: ' SQL ', prompts: ['Ask this', ' '] }]);
  assert.deepEqual(Object.keys(payload[0]).sort(), ['anchors', 'description', 'is_required', 'name', 'prompts', 'question', 'weight']);
  assert.equal(payload[0].name, 'SQL');
  assert.deepEqual(payload[0].prompts, ['Ask this']);
  assert.deepEqual(employerPage.weightShares([{ weight: 3 }, { weight: 1 }]), [75, 25]);
  assert.equal(employerPage.weightedRating([{ weight: 3, meanRating: 4 }, { weight: 1, meanRating: null }]), 4);
  assert.equal(employerPage.weightedRating([{ weight: 3, meanRating: 4 }, { weight: 1, meanRating: 2 }]), 3.5);
});

const serverResult = (overrides = {}) => ({
  rubric_id: 'r1', rubric_version: 1, submitted_scorecards: 1, criteria_count: 2, assessed_count: 1,
  required_count: 2, required_assessed: 1, coverage_percent: 75, is_complete: false, score: null,
  criteria: [
    { criterion_id: 'c1', name: 'SQL', weight: 3, is_required: true, rating_count: 1, not_assessed_count: 0, mean_rating: 4, spread: 0 },
    { criterion_id: 'c2', name: 'Communication', weight: 1, is_required: true, rating_count: 0, not_assessed_count: 1, mean_rating: null, spread: null },
  ],
  ...overrides,
});

test('reviewed evaluation results keep missing evidence visible and unscored', () => {
  const parsed = employerPage.parseApplicationEvaluation({ current_rubric_id: 'r1', versions: [serverResult()] });
  const result = parsed.versions[0];
  assert.equal(result.score, null);
  assert.deepEqual(employerPage.unassessedRequired(result), ['Communication']);
  assert.equal(result.criteria[1].meanRating, null);
  assert.equal(employerPage.evaluationLabel(result, true), 'In progress · 75% covered');
  assert.equal(employerPage.evaluationLabel(null, false), 'No rubric yet');
  const split = employerPage.parseEvaluationResult(serverResult({ criteria: [{ ...serverResult().criteria[0], spread: 2 }] }));
  assert.deepEqual(employerPage.disagreements(split), ['SQL']);
  const html = renderToStaticMarkup(React.createElement(employerPage.ReviewedEvaluationPanel, { result, olderVersions: [], hasRubric: true, isCurrentVersion: true }));
  assert.match(html, /4.0 \/ 4.0/);
  assert.match(html, /not treated as low ratings/);
  assert.match(html, /Not assessed/);
  assert.match(html, /75%/);
});

test('next action never advances or rejects on a score', () => {
  const complete = employerPage.parseEvaluationResult(serverResult({ score: 90, required_assessed: 2, is_complete: true, criteria: serverResult().criteria.map((item) => ({ ...item, rating_count: 1, mean_rating: 3 })) }));
  assert.equal(employerPage.nextAction('Pending', 'none', complete, true, true).label, 'Decide the next stage');
  assert.equal(employerPage.nextAction('Pending', 'none', null, false, false).label, 'Set up a rubric');
  assert.equal(employerPage.nextAction('Pending', 'none', null, true, false).label, 'Complete your scorecard');
  assert.equal(employerPage.nextAction('Shortlisted', 'none', employerPage.parseEvaluationResult(serverResult()), true, true).label, 'Gather evidence');
  assert.equal(employerPage.nextAction('Interviewing', 'none', complete, true, true).label, 'Send message request');
  assert.equal(employerPage.nextAction('Withdrawn', 'none', complete, true, true).label, 'No action');
});

test('applicant lists stay within one job and never rank missing scores as zero', () => {
  const app = (id, jobId, appliedDate, matched, status = 'Pending') => ({
    id, jobId, appliedDate, lastActivity: `${appliedDate}T00:00:00Z`, status, publicId: id, fullName: id, matchedSkills: matched, missingSkills: [], messageRequestState: 'none',
  });
  const jobs = [{ id: 'J1', requiredSkills: ['SQL', 'Excel'] }, { id: 'J2', requiredSkills: ['SQL'] }];
  const applications = [app('A', 'J1', '2026-09-03', ['SQL']), app('B', 'J1', '2026-09-01', ['SQL', 'Excel']), app('C', 'J1', '2026-09-02', []), app('D', 'J2', '2026-09-01', ['SQL'], 'Shortlisted')];
  const filters = { ...employerPage.DEFAULT_CANDIDATE_FILTERS, jobId: 'J1' };
  const ids = (list) => list.map((item) => item.id);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, filters, new Map())), ['B', 'C', 'A']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, sort: 'profile-match' }, new Map())), ['B', 'A', 'C']);
  const summaries = new Map([['A', { result: employerPage.parseEvaluationResult(serverResult({ score: 70 })) }]]);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, sort: 'reviewed' }, summaries)), ['A', 'B', 'C']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, search: 'excel' }, new Map())), ['B']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, jobId: 'J2', status: 'Shortlisted' }, new Map())), ['D']);
});

test('applicant rows state both measures in words, with the next step', () => {
  const candidate = employerPage.toCandidateApplication({ id: 'app-1', job_id: 'J1', status: 'pending', applied_at: '2026-09-01T00:00:00Z', matched_skills: ['SQL'], missing_skills: ['Excel'], match_score: 57 }, [], [], 'KR-001');
  const html = renderToStaticMarkup(React.createElement(employerPage.ApplicantRow, { candidate, job: { id: 'J1', requiredSkills: ['SQL', 'Excel'] }, hasRubric: false, onReview: () => {} }));
  assert.match(html, /Profile match: <\/span>1 of 2 required skills/);
  assert.match(html, /Reviewed evaluation: <\/span>No rubric/);
  assert.match(html, /Next: Set up the assessment/);
  assert.match(html, /Match 50%/);
  assert.doesNotMatch(html, /57%/);
});

test('applicant rows point at the assessment before a scorecard can start', () => {
  const candidate = employerPage.toCandidateApplication({ id: 'app-1', job_id: 'J1', status: 'shortlisted', applied_at: '2026-09-01T00:00:00Z', matched_skills: ['SQL'], missing_skills: [] }, [], [], 'KR-001');
  const job = { id: 'J1', requiredSkills: ['SQL'] };
  const row = (assessment) => renderToStaticMarkup(React.createElement(employerPage.ApplicantRow, { candidate, job, assessment, hasRubric: true, onReview: () => {} }));
  assert.match(row(null), /Next: Send Assessment/);
  assert.match(row({ status: 'pending' }), /Next: Awaiting candidate response/);
  assert.match(row({ status: 'submitted' }), /Next: Review the assessment/);
  assert.match(row(null), /Match 100%/);
});

test('the high-match quick filter keeps applicants at 70% or more', () => {
  const app = (id, matched) => ({ id, jobId: 'J1', appliedDate: '2026-09-01', lastActivity: '', status: 'Pending', publicId: id, fullName: id, matchedSkills: matched, missingSkills: ['X'], messageRequestState: 'none' });
  const jobs = [{ id: 'J1', requiredSkills: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] }];
  const applications = [app('seven', ['A', 'B', 'C', 'D', 'E', 'F', 'G']), app('six', ['A', 'B', 'C', 'D', 'E', 'F']), app('none', [])];
  const filters = { ...employerPage.DEFAULT_CANDIDATE_FILTERS, jobId: 'J1', highMatch: true };
  assert.deepEqual(employerPage.visibleApplicants(applications, jobs, filters, new Map()).map((item) => item.id), ['seven']);
});

test('bulk stage changes follow the same rules as the database', () => {
  const blocker = employerPage.candidateActionBlocker;
  assert.equal(blocker('shortlisted', { status: 'Pending' }, null, true), null);
  assert.ok(blocker('shortlisted', { status: 'Shortlisted' }, null, true));
  assert.equal(blocker('send-assessment', { status: 'Pending' }, null, true), null);
  assert.equal(blocker('send-assessment', { status: 'Interviewing' }, null, true), null);
  assert.ok(blocker('send-assessment', { status: 'Shortlisted' }, { status: 'pending' }, true));
  assert.ok(blocker('send-assessment', { status: 'Shortlisted' }, null, false));
  assert.ok(blocker('interviewing', { status: 'Shortlisted' }, { status: 'submitted' }, true));
  assert.equal(blocker('interviewing', { status: 'Shortlisted' }, { status: 'reviewed' }, true), null);
  assert.ok(blocker('rejected', { status: 'Pending' }, null, true));
  assert.equal(blocker('rejected', { status: 'Interviewing' }, null, true), null);
  assert.equal(blocker('hired', { status: 'Interviewing' }, null, true), null);
  assert.ok(blocker('hired', { status: 'Withdrawn' }, null, true));
});

test('archived jobs stay archived after their deadline passes', () => {
  const archived = employerPage.toEmployerJob({ job_id: 'r', job_title: 'Role', posting_status: 'archived', application_deadline: '2020-01-01' });
  assert.equal(archived.status, 'archived');
  const expired = employerPage.toEmployerJob({ job_id: 'r', job_title: 'Role', posting_status: 'active', application_deadline: '2020-01-01' });
  assert.equal(expired.status, 'closed');
  assert.equal(employerPage.JOB_POSTING_STATUS.open, 'active');
});

test('each job has its own page under /employer/jobs', async () => {
  const routes = await loadUtility('../src/pages/employer/routes.ts');
  assert.equal(routes.employerJobPath('EMP-1'), '/employer/jobs/EMP-1');
  assert.equal(routes.employerJobIdFromPath('/employer/jobs/EMP-1'), 'EMP-1');
  assert.equal(routes.employerJobIdFromPath('/employer/jobs'), '');
  assert.equal(routes.employerPageFromPath('/employer/jobs/EMP-1'), 'jobs');
  assert.ok(routes.isEmployerWorkspacePath('/employer/jobs/EMP-1/'));
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


test('assessment form separates candidate answers from employer scorecard', async () => {
  const { CandidateAssessmentModal } = await loadModule('../src/pages/candidate/CandidateAssessmentModal.tsx');
  const assessment = { id: 'a1', status: 'pending', questions: [{ id: 'q1', sourceCriterionId: 'c1', name: 'SQL', description: 'Uses SQL at work', question: 'Describe a query you improved.', required: true, response: '' }] };
  const html = renderToStaticMarkup(React.createElement(CandidateAssessmentModal, { assessment, jobTitle: 'Analyst', onClose: () => {}, onSaved: () => {} }));
  assert.match(html, /Describe a query you improved/);
  assert.match(html, /Save draft/);
  assert.match(html, /Submit Assessment/);
  assert.doesNotMatch(html, /Your Rating/);
  const submitted = renderToStaticMarkup(React.createElement(CandidateAssessmentModal, { assessment: { ...assessment, status: 'submitted', questions: [{ ...assessment.questions[0], response: 'I improved a slow query.' }] }, jobTitle: 'Analyst', onClose: () => {}, onSaved: () => {} }));
  assert.match(submitted, /read-only/);
  assert.match(submitted, /I improved a slow query/);
  assert.doesNotMatch(submitted, /Submit Assessment/);
});

test('scorecard shows submitted evidence before the employer rating', () => {
  const rubric = { id: 'r1', criteria: [{ id: 'c1', name: 'SQL', description: 'Uses SQL at work', weight: 3, isRequired: true, anchors: ['No evidence', 'Partial', 'Clear', 'Strong'], prompts: [], question: 'Describe a query you improved.' }] };
  const assessment = { status: 'submitted', questions: [{ sourceCriterionId: 'c1', question: 'Describe a query you improved.', response: 'I improved a slow query.' }] };
  const html = renderToStaticMarkup(React.createElement(employerPage.ScorecardForm, { rubric, assessment, existing: null, saving: false, disabled: false, onSave: () => {} }));
  assert.ok(html.indexOf('Candidate Response') < html.indexOf('Your Rating'));
  assert.match(html, /I improved a slow query/);
  assert.match(html, /Add notes supporting your rating/);
  assert.match(html, /Not assessed/);
});

test('assessment templates live under /employer/jobs/assessments, never as a job id', async () => {
  const routes = await loadUtility('../src/pages/employer/routes.ts');
  assert.equal(routes.employerTemplatePath(), '/employer/jobs/assessments');
  assert.equal(routes.employerTemplatePath('t1'), '/employer/jobs/assessments/t1');
  assert.equal(routes.employerTemplateIdFromPath('/employer/jobs/assessments'), '');
  assert.equal(routes.employerTemplateIdFromPath('/employer/jobs/assessments/new'), 'new');
  assert.equal(routes.employerTemplateIdFromPath('/employer/jobs/EMP-1'), null);
  assert.equal(routes.employerJobIdFromPath('/employer/jobs/assessments'), '');
  assert.equal(routes.employerPageFromPath('/employer/jobs/assessments/t1'), 'jobs');
  assert.ok(routes.isEmployerWorkspacePath('/employer/jobs/assessments/t1'));
});

test('combined templates ask a shared question once, in the order chosen', () => {
  const draft = (name, question = `About ${name}?`) => ({ key: name, name, description: '', weight: 2, isRequired: true, anchors: ['a', 'b', 'c', 'd'], prompts: [''], question });
  const combined = employerPage.combineTemplates([{ criteria: [draft('SQL'), draft('Communication')] }, { criteria: [draft('communication '), draft('Excel')] }]);
  assert.deepEqual(combined.map((item) => item.name), ['SQL', 'Communication', 'Excel']);
  assert.notEqual(combined[0].key, 'SQL');
  const stored = employerPage.templateCriteriaToDraft([{ name: 'SQL', question: 'Q?', weight: 3, is_required: false }]);
  assert.equal(stored[0].question, 'Q?');
  assert.equal(stored[0].isRequired, false);
  assert.equal(stored[0].anchors.length, 4);
});

test('the assessment summary lists each question and what is still missing', () => {
  const draft = (name, question) => ({ key: name || 'blank', name, description: '', weight: 2, isRequired: true, anchors: ['a', 'b', 'c', 'd'], prompts: [''], question });
  const summary = employerPage.summarizeCriteria([draft('SQL', 'Describe a query.'), draft('', '')]);
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.ready, 1);
  assert.deepEqual(summary.rows[1].issues, ['Needs a name', 'Needs a question']);
  assert.equal(summary.rows[0].share, 50);
  assert.ok(summary.problem);
});
