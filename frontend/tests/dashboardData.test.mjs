import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { readCandidateSource } from './helpers/candidateSource.mjs';

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
  ...await loadUtility('../src/lib/assessmentDeadline.ts'),
  ...await loadUtility('../src/lib/answerLinks.ts'),
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
  '../src/pages/employer/jobDraft.ts',
  '../src/pages/employer/insights/matchTiers.ts',
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

test('the Fit-Now job closest to the resume is labelled Closest Fit, not Fit Now', () => {
  const closest = page.mapRunMatch({ job_id: 'role-3', job_title: 'Role', fit_now_fallback: true,
    fit_now_fallback_reason: 'closest_to_resume' }, 'fit-now');
  assert.equal(closest.matchCategory, 'fit-now');
  assert.equal(page.matchCategoryBadge(closest), 'Closest Fit');
  // A full Fit-Now job shown from outside the chosen region keeps its label.
  const outside = page.mapRunMatch({ job_id: 'role-4', job_title: 'Role', fit_now_fallback: true,
    fit_now_fallback_reason: 'outside_region_filter' }, 'fit-now');
  assert.equal(page.matchCategoryBadge(outside), 'Fit Now');
  assert.equal(page.matchCategoryBadge(page.mapRunMatch({ job_id: 'role-5', job_title: 'Role' }, 'fit-now')), 'Fit Now');
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

test('employer applicants take name and location only from the revealed identity', () => {
  // Rows from before the privacy migration may still carry copies; they are ignored.
  const row = { id: 'app-1', user_id: 'abcdef12-0000', job_id: 'role-1', status: 'pending', candidate_name: 'Old Copy', candidate_location: 'Somewhere' };
  const masked = employerPage.toCandidateApplication(row, []);
  assert.equal(masked.fullName, 'Candidate abcdef12');
  assert.equal(masked.location, 'Location not provided');
  const revealed = employerPage.toCandidateApplication({ ...row, status: 'interviewing' }, [], [], 'KR-001',
    { full_name: 'Cara One', email: 'cara@example.com', location: 'Iloilo City, Iloilo' });
  assert.equal(revealed.fullName, 'Cara One');
  assert.equal(revealed.location, 'Iloilo City, Iloilo');
  const emailOnly = employerPage.toCandidateApplication(row, [], [], '', { full_name: null, email: 'cara@example.com' });
  assert.equal(emailOnly.fullName, 'cara@example.com');
});

// The employer sees one match figure: the candidate's own fit score at
// application, the same number the candidate saw. The skills found and not
// found come from the evidence saved with the application and are listed by
// name; they are not turned into a second percentage.
test('the match figure is the fit score saved at application, with the saved skill evidence beside it', () => {
  const application = { applyTimeRankingScore: 89, matchedSkills: ['SQL', 'excel', 'Python', 'Tableau', 'Statistics'], missingSkills: ['R'] };
  const job = { requiredSkills: ['SQL', 'Excel', 'Python', 'Tableau', 'Statistics', 'R'] };
  const match = employerPage.profileMatch(application, job);
  assert.equal(match.percent, 89);
  assert.deepEqual(match.notFound, ['R']);
  assert.equal(employerPage.profileMatchLabel(match), 'SQL, excel, Python +2');
  assert.equal(employerPage.matchScoreLabel(match), 'Match 89%');
  // The saved evidence is the source; the job's current wording does not change it.
  assert.deepEqual(employerPage.profileMatch(application, { requiredSkills: [...job.requiredSkills, 'dbt'] }), match);
  assert.deepEqual(employerPage.profileMatch(application, null), match);
  // A skill listed as both found and missing counts once, as found.
  assert.deepEqual(employerPage.profileMatch({ matchedSkills: ['SQL'], missingSkills: ['sql', 'R'] }, null).notFound, ['R']);
  // No score saved: no number, rather than 0%, though the skills are still listed.
  const unscored = employerPage.profileMatch({ ...application, applyTimeRankingScore: null }, job);
  assert.equal(unscored.percent, null);
  assert.equal(employerPage.matchScoreLabel(unscored), 'Match n/a');
  assert.deepEqual(unscored.found, match.found);
  // No evidence recorded: the skills are unknown, but the score still shows.
  const empty = employerPage.profileMatch({ applyTimeRankingScore: 40, matchedSkills: [], missingSkills: [] }, job);
  assert.equal(empty.percent, 40);
  assert.equal(employerPage.profileMatchLabel(empty), 'No skill evidence recorded');
  assert.deepEqual(empty.found, []);
  assert.deepEqual(empty.notFound, []);
});

// Regression for the expert test: the candidate's screen showed "You have HTML
// And CSS, Javascript Programming" (89% fit) while the employer's showed "0 of 3
// required skills found" (0%) because the job's own wording ("HTML", "CSS",
// "JavaScript") was compared with the matching service's canonical names.
test('the employer sees the same 89% and the same matched skills the candidate saw when applying', () => {
  const row = { id: 'app-1', job_id: 'emp-1', status: 'pending', match_score: 89, matched_skills: ['HTML And CSS', 'Javascript Programming'], missing_skills: ['React'] };
  const application = employerPage.toCandidateApplication(row, []);
  const job = { requiredSkills: ['HTML', 'CSS', 'JavaScript', 'React'] };
  const match = employerPage.profileMatch(application, job);
  assert.equal(match.percent, 89);
  assert.equal(employerPage.matchScoreLabel(match), 'Match 89%');
  assert.deepEqual(match.found, ['HTML And CSS', 'Javascript Programming']);
  assert.deepEqual(match.notFound, ['React']);
  assert.notEqual(match.percent, 0);
});

test('an application sends only the job; the backend scores it (audit APP-01)', () => {
  const dashboardSource = readCandidateSource();
  assert.match(dashboardSource, /submitJobApplication\(\{ jobId: job\.id, jobSource: job\.jobSource \}\)/);
  assert.doesNotMatch(dashboardSource, /match_score: job\.hasMatchScore/);
});

test('starter assessment drafts read naturally and vary per question', () => {
  const draft = employerPage.starterRubric({
    title: 'Hotel Front Desk Agent',
    requiredSkills: ['Guest Relations', 'Reservation Management', 'Communication'],
    responsibilities: ['Check guests in and out', 'Manage room reservations and booking changes.'],
  });
  assert.equal(draft.length, 5);
  const questions = draft.map((criterion) => criterion.question);
  assert.equal(new Set(questions.map((question) => question.split(' ').slice(0, 3).join(' '))).size, 5, 'each question opens differently');
  assert.match(questions[2], /as a Hotel Front Desk Agent\?$/);
  assert.equal(questions[3], 'As a Hotel Front Desk Agent, part of your work would be: check guests in and out. How would you go about it, and how would you know it went well?');
  assert.match(questions[4], /^Tell us about a time you handled work like this: manage room reservations and booking changes\. /);
  assert.deepEqual(draft.map((criterion) => [criterion.weight, criterion.isRequired]), [[3, true], [3, true], [3, true], [2, false], [2, false]]);
  assert.match(employerPage.starterRubric({ requiredSkills: ['Leadership Skills'], responsibilities: [] })[0].question, /your Leadership Skills made/);
  // Acronyms keep their case; a missing title still reads as a sentence.
  const untitled = employerPage.starterRubric({ requiredSkills: [], responsibilities: ['SQL reporting for finance'] });
  assert.match(untitled[0].question, /^As a member of this team, part of your work would be: SQL reporting for finance\. /);
});

test('rubric drafts are validated and serialised for the database', () => {
  const starter = employerPage.starterRubric({ requiredSkills: ['SQL', 'Excel'], responsibilities: ['Build weekly sales reports'] });
  assert.equal(starter.length, 3);
  assert.equal(employerPage.validateRubricDraft(starter), null);
  assert.match(starter[0].question, /SQL/);
  assert.equal(employerPage.canDraftFromJob({ requiredSkills: [' '], responsibilities: [] }), false);
  assert.equal(employerPage.canDraftFromJob({ requiredSkills: ['SQL'], responsibilities: [] }), true);
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
  const app = (id, jobId, appliedDate, matched, status = 'Pending', score = null) => ({
    id, jobId, appliedDate, lastActivity: `${appliedDate}T00:00:00Z`, status, publicId: id, fullName: id, matchedSkills: matched, missingSkills: [], applyTimeRankingScore: score, messageRequestState: 'none',
  });
  const jobs = [{ id: 'J1', requiredSkills: ['SQL', 'Excel'] }, { id: 'J2', requiredSkills: ['SQL'] }];
  const applications = [app('A', 'J1', '2026-09-03', ['SQL'], 'Pending', 50), app('B', 'J1', '2026-09-01', ['SQL', 'Excel'], 'Pending', 100), app('C', 'J1', '2026-09-02', []), app('D', 'J2', '2026-09-01', ['SQL'], 'Shortlisted', 80)];
  const filters = { ...employerPage.DEFAULT_CANDIDATE_FILTERS, jobId: 'J1' };
  const ids = (list) => list.map((item) => item.id);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, filters, new Map())), ['B', 'C', 'A']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, sort: 'profile-match' }, new Map())), ['B', 'A', 'C']);
  const summaries = new Map([['A', { result: employerPage.parseEvaluationResult(serverResult({ score: 70 })) }]]);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, sort: 'reviewed' }, summaries)), ['A', 'B', 'C']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, search: 'excel' }, new Map())), ['B']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, jobId: 'J2', status: 'Shortlisted' }, new Map())), ['D']);
});

test('the applicant list starts on every job, scoring each applicant against their own job', () => {
  const app = (id, jobId, appliedDate, matched, missing = [], score = null) => ({
    id, jobId, appliedDate, lastActivity: '', status: 'Pending', publicId: id, fullName: id, role: jobId, matchedSkills: matched, missingSkills: missing, applyTimeRankingScore: score, messageRequestState: 'none',
  });
  const jobs = [{ id: 'J1', requiredSkills: ['SQL', 'Excel'] }, { id: 'J2', requiredSkills: ['SQL'] }];
  const applications = [app('A', 'J1', '2026-09-03', ['SQL'], ['Excel'], 50), app('B', 'J2', '2026-09-01', ['SQL'], [], 90), app('C', 'J1', '2026-09-02', [])];
  const filters = employerPage.DEFAULT_CANDIDATE_FILTERS;
  assert.equal(filters.jobId, employerPage.ALL_JOBS);
  const ids = (list) => list.map((item) => item.id);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, filters, new Map())), ['B', 'C', 'A']);
  // B scored 90% for J2; A scored 50% for J1.
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, highMatch: true }, new Map())), ['B']);
  assert.deepEqual(ids(employerPage.visibleApplicants(applications, jobs, { ...filters, search: 'j2' }, new Map())), ['B']);
});

test('applicant rows show the fit score and the skills found, with the next step', () => {
  const candidate = employerPage.toCandidateApplication({ id: 'app-1', job_id: 'J1', status: 'pending', applied_at: '2026-09-01T00:00:00Z', matched_skills: ['SQL'], missing_skills: ['Excel'], match_score: 57 }, [], [], 'KR-001');
  const html = renderToStaticMarkup(React.createElement(employerPage.ApplicantRow, { candidate, job: { id: 'J1', requiredSkills: ['SQL', 'Excel'] }, hasRubric: false, onReview: () => {} }));
  assert.match(html, /Skills found: <\/span>SQL/);
  assert.match(html, /Reviewed evaluation: <\/span>No rubric/);
  assert.match(html, /Next: Set up the assessment/);
  assert.match(html, /Match 57%/);
  assert.doesNotMatch(html, /Match 50%/);
});

test('applicant rows point at the assessment before a scorecard can start', () => {
  const candidate = employerPage.toCandidateApplication({ id: 'app-1', job_id: 'J1', status: 'shortlisted', applied_at: '2026-09-01T00:00:00Z', matched_skills: ['SQL'], missing_skills: [], match_score: 100 }, [], [], 'KR-001');
  const job = { id: 'J1', requiredSkills: ['SQL'] };
  const row = (assessment) => renderToStaticMarkup(React.createElement(employerPage.ApplicantRow, { candidate, job, assessment, hasRubric: true, onReview: () => {} }));
  assert.match(row(null), /Next: Send Assessment/);
  assert.match(row({ status: 'pending' }), /Next: Awaiting candidate response/);
  assert.match(row({ status: 'submitted' }), /Next: Review the assessment/);
  assert.match(row(null), /Match 100%/);
});

test('the high-match quick filter keeps applicants at 70% or more', () => {
  const required = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  // The saved evidence covers every required skill: found, or listed as missing.
  const app = (id, matched, score = null) => ({ id, jobId: 'J1', appliedDate: '2026-09-01', lastActivity: '', status: 'Pending', publicId: id, fullName: id, applyTimeRankingScore: score, matchedSkills: matched, missingSkills: required.filter((skill) => !matched.includes(skill)), messageRequestState: 'none' });
  const jobs = [{ id: 'J1', requiredSkills: required }];
  const applications = [app('eight', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 80), app('seven', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 70), app('none', [])];
  const filters = { ...employerPage.DEFAULT_CANDIDATE_FILTERS, jobId: 'J1', highMatch: true };
  assert.deepEqual(employerPage.visibleApplicants(applications, jobs, filters, new Map()).map((item) => item.id), ['eight', 'seven']);
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


test('qualifications round-trip apart from responsibilities', () => {
  const text = deps.joinJobContent('Front desk role.', 'Check guests in\n- Manage bookings', "Bachelor's degree in Hospitality, Tourism or related field\n");
  assert.equal(text, "Front desk role.\n\nResponsibilities:\n- Check guests in\n- Manage bookings\n\nQualifications:\n- Bachelor's degree in Hospitality, Tourism or related field");
  assert.deepEqual(deps.splitJobContent(text), {
    description: 'Front desk role.',
    responsibilities: ['Check guests in', 'Manage bookings'],
    qualifications: ["Bachelor's degree in Hospitality, Tourism or related field"],
  });
  assert.equal(deps.joinJobContent('Front desk role.', 'Check guests in'), 'Front desk role.\n\nResponsibilities:\n- Check guests in');

  const fromColumns = employerPage.toEmployerJob({ job_id: 'role-3', job_title: 'Role', job_description: text, responsibilities: 'Check guests in', qualifications: 'Licensed\n\nFluent in English' });
  assert.equal(fromColumns.description, 'Front desk role.');
  assert.deepEqual(fromColumns.qualifications, ['Licensed', 'Fluent in English']);
  const fromText = employerPage.toEmployerJob({ job_id: 'role-4', job_title: 'Role', job_description: text });
  assert.deepEqual(fromText.responsibilities, ['Check guests in', 'Manage bookings']);
  assert.deepEqual(fromText.qualifications, ["Bachelor's degree in Hospitality, Tourism or related field"]);
  assert.equal(employerPage.jobToDraft(fromText).form.qualifications, "Bachelor's degree in Hospitality, Tourism or related field");
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
  assert.match(html, /Not assessed/);
  // One optional notes box for the whole scorecard; no notes needed per rating.
  assert.doesNotMatch(html, /Add notes supporting your rating/);
  assert.equal(html.match(/<textarea/g).length, 1);
  assert.match(html, /Assessment Notes \(optional\)/);
  const rated = { id: 's1', status: 'draft', summaryNotes: '', ratings: { c1: { rating: 3, evidence: '' } }, updatedAt: '2026-10-26T00:00:00Z', submittedAt: null };
  const ratedHtml = renderToStaticMarkup(React.createElement(employerPage.ScorecardForm, { rubric, assessment, existing: rated, saving: false, disabled: false, onSave: () => {} }));
  assert.match(ratedHtml, /<button class="k-btn k-btn-primary" type="submit">/, 'a rating without notes can be submitted');
  // Per-question notes from older scorecards are not shown; only Assessment Notes remain.
  const withNote = { ...rated, ratings: { c1: { rating: 3, evidence: 'Gave a clear example.' } } };
  const withNoteHtml = renderToStaticMarkup(React.createElement(employerPage.ScorecardForm, { rubric, assessment, existing: withNote, saving: false, disabled: false, onSave: () => {} }));
  assert.doesNotMatch(withNoteHtml, /Earlier note|Gave a clear example/);
  assert.match(withNoteHtml, /Assessment Notes \(optional\)/);
});

test('saving a job assessment needs no template step, and the template it is saved as can be opened', async () => {
  await loadModule('../src/pages/employer/AssessmentCriteriaEditor.tsx');
  const { RubricEditorModal } = await loadModule('../src/pages/employer/RubricEditorModal.tsx');
  const rubric = { id: 'r1', jobPostId: 'p1', version: 1, createdAt: '', supersededAt: null, templateId: 't1', criteria: [{ id: 'c1', position: 0, name: 'SQL', description: '', weight: 3, isRequired: true, anchors: ['a', 'b', 'c', 'd'], prompts: [], question: 'Describe a query you improved.' }] };
  const templates = [{ id: 't1', name: 'Analyst assessment', description: '', criteria: [], updatedAt: '' }];
  const html = renderToStaticMarkup(React.createElement(RubricEditorModal, {
    job: { id: 'j1', title: 'Analyst', requiredSkills: [], responsibilities: [] }, rubric, inUse: false, saving: false, templates,
    onCancel: () => {}, onSave: () => {}, onOpenTemplate: () => {},
  }));
  assert.doesNotMatch(html, /Also save as a reusable template/);
  assert.match(html, /Saved as the template <strong>Analyst assessment<\/strong>/);
  assert.match(html, /View template/);
  assert.match(html, /keeps this assessment in Assessment templates/);
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

test('the job editor is its own page under Jobs, apart from job pages and templates', async () => {
  const routes = await loadUtility('../src/pages/employer/routes.ts');
  assert.equal(routes.employerJobEditorPath(), '/employer/jobs/new');
  assert.equal(routes.employerJobEditorPath('EMP-1'), '/employer/jobs/EMP-1/edit');
  assert.equal(routes.employerJobEditorIdFromPath('/employer/jobs/new'), '');
  assert.equal(routes.employerJobEditorIdFromPath('/employer/jobs/EMP-1/edit/'), 'EMP-1');
  assert.equal(routes.employerJobEditorIdFromPath('/employer/jobs/EMP-1'), null);
  assert.equal(routes.employerJobEditorIdFromPath('/employer/jobs/assessments/edit'), null);
  assert.equal(routes.employerJobIdFromPath('/employer/jobs/new'), '');
  assert.equal(routes.employerJobIdFromPath('/employer/jobs/EMP-1'), 'EMP-1');
  assert.equal(routes.employerPageFromPath('/employer/jobs/new'), 'jobs');
  assert.equal(routes.employerPageFromPath('/employer/jobs/EMP-1/edit'), 'jobs');
  assert.ok(routes.isEmployerWorkspacePath('/employer/jobs/new'));
  assert.ok(routes.isEmployerWorkspacePath('/employer/jobs/EMP-1/edit'));
});

test('job drafts keep only real work and read back safely', () => {
  const blank = employerPage.jobToDraft(null);
  assert.equal(employerPage.hasJobDraftContent(blank), false);
  assert.equal(employerPage.hasJobDraftContent({ ...blank, form: { ...blank.form, salaryRange: '-' } }), false);
  assert.equal(employerPage.hasJobDraftContent({ ...blank, form: { ...blank.form, title: 'Data Analyst' } }), true);
  assert.equal(employerPage.hasJobDraftContent({ ...blank, requiredSkillInput: 'SQL' }), true);

  const placed = employerPage.jobToDraft(null, { city: ' Lucena City ', province: 'Quezon' });
  assert.equal(placed.form.city, 'Lucena City');
  assert.equal(placed.form.province, 'Quezon');
  assert.equal(placed.form.title, '');
  assert.equal(employerPage.jobToDraft({ ...placed.form, id: 'EMP-1', responsibilities: [], qualifications: [], requiredSkills: [], niceToHaveSkills: [], salaryRange: '', city: 'Makati City', province: 'Metro Manila' }, { city: 'Lucena City', province: 'Quezon' }).form.city, 'Makati City');

  assert.equal(employerPage.jobDraftKey('user-1'), 'kareerly:employer-job-draft:user-1:new');
  assert.equal(employerPage.jobDraftKey('user-1', 'EMP-1'), 'kareerly:employer-job-draft:user-1:EMP-1');

  const stored = JSON.stringify({ form: { title: 'Data Analyst', city: 42 }, requiredSkills: ['SQL', 7], savedAt: '2026-10-01T00:00:00Z' });
  const parsed = employerPage.parseJobDraft(stored, blank.form);
  assert.equal(parsed.form.title, 'Data Analyst');
  assert.equal(parsed.form.city, '');
  assert.equal(parsed.form.status, 'draft');
  assert.deepEqual(parsed.requiredSkills, ['SQL']);
  assert.equal(parsed.niceSkillInput, '');
  assert.equal(parsed.savedAt, '2026-10-01T00:00:00Z');
  assert.equal(employerPage.parseJobDraft('not json', blank.form), null);
  assert.equal(employerPage.parseJobDraft('null', blank.form), null);
  assert.equal(employerPage.parseJobDraft(null, blank.form), null);
  assert.equal(employerPage.jobDraftSignature(parsed), employerPage.jobDraftSignature({ ...parsed, savedAt: 'later' }));

  assert.deepEqual(employerPage.addSkills(['SQL'], 'excel, sql, Excel, Power BI'), ['SQL', 'excel', 'Power BI']);
  assert.equal(employerPage.addSkills(['SQL'], 'sql'), null);

  assert.equal(employerPage.validateJobDraft(blank), 'Add a job title.');
  // Save draft needs only a title; posting needs every required field.
  const halfFilled = { ...blank, form: { ...blank.form, title: 'Front Desk Agent', salaryRange: '12000-' } };
  assert.equal(employerPage.validateDraftSave(blank), 'Add a job title to save a draft.');
  assert.equal(employerPage.validateDraftSave(halfFilled), null);
  assert.equal(employerPage.validateJobDraft({ ...halfFilled, form: { ...halfFilled.form, category: 'x', subcategory: 'x', experienceLevel: 'x', workSetup: 'x', city: 'x', province: 'x', deadline: '2026-12-01' } }), 'Enter both a minimum and a maximum salary.');

  // A one-sided salary on a saved draft comes back to the editor as entered.
  const minimumOnly = employerPage.toEmployerJob({ job_id: 'EMP-2', job_title: 'Front Desk Agent', salary_min_php: 12000, salary_max_php: null, posting_status: 'draft' });
  assert.equal(minimumOnly.salaryRange, 'From ₱12,000');
  assert.equal(employerPage.jobToDraft(minimumOnly).form.salaryRange, '12000-');
  const maximumOnly = employerPage.toEmployerJob({ job_id: 'EMP-3', job_title: 'Front Desk Agent', salary_max_php: 20000, posting_status: 'draft' });
  assert.equal(employerPage.jobToDraft(maximumOnly).form.salaryRange, '-20000');
  const fullRange = employerPage.toEmployerJob({ job_id: 'EMP-4', job_title: 'Front Desk Agent', salary_min_php: 12000, salary_max_php: 20000 });
  assert.equal(fullRange.salaryRange, '₱12,000 - 20,000');
  assert.equal(employerPage.jobToDraft(fullRange).form.salaryRange, '12000-20000');
  assert.equal(minimumOnly.deadline, '');

  const now = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(employerPage.draftSavedLabel('2026-10-02T11:59:30Z', now), 'just now');
  assert.equal(employerPage.draftSavedLabel('2026-10-02T11:55:00Z', now), '5 minutes ago');
  assert.equal(employerPage.draftSavedLabel('2026-10-02T10:00:00Z', now), '2 hours ago');
  assert.equal(employerPage.draftSavedLabel('nope', now), '');
});

test('contact numbers keep digits only, up to 11', async () => {
  const { contactNumberInput } = await loadUtility('../src/lib/contactNumber.ts');
  assert.equal(contactNumberInput('0912-345-6789'), '09123456789');
  assert.equal(contactNumberInput('0912 345 678912345'), '09123456789');
  assert.equal(contactNumberInput('abc'), '');
});

test('declining for no response is open only once the assessment deadline has passed', () => {
  const blocker = employerPage.candidateActionBlocker;
  const shortlisted = { status: 'Shortlisted' };
  const open = { status: 'pending', dueAt: new Date(Date.now() + 3 * 86400000).toISOString() };
  const overdue = { status: 'pending', dueAt: new Date(Date.now() - 3600000).toISOString() };
  assert.match(blocker('rejected', shortlisted, open, true), /the candidate has until/);
  assert.equal(blocker('rejected', shortlisted, overdue, true), null);
  // Moving someone to Interviewing still needs a reviewed assessment, deadline or not.
  assert.ok(blocker('interviewing', shortlisted, overdue, true));
  assert.equal(employerPage.assessmentAwareAction('Shortlisted', 'none', null, true, false, overdue).label, 'Deadline passed');
  assert.equal(employerPage.assessmentAwareAction('Shortlisted', 'none', null, true, false, open).label, 'Awaiting candidate response');
});
