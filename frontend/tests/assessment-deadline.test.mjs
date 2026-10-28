import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/assessmentDeadline.ts', import.meta.url), 'utf8');
const deadline = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

// 2026-11-01 12:00 Philippine time.
const NOW = new Date('2026-11-01T04:00:00Z');

test('the default deadline is seven days out and lasts to the end of that day, Philippine time', () => {
  assert.equal(deadline.DEFAULT_ASSESSMENT_DAYS, 7);
  assert.equal(deadline.defaultAssessmentDueDate(NOW), '2026-11-08');
  assert.equal(deadline.dueDateToTimestamp('2026-11-08'), '2026-11-08T15:59:00.000Z');
  assert.equal(deadline.dueDayOf('2026-11-08T15:59:00.000Z'), '2026-11-08');
});

test('an employer can pick another day within the allowed range', () => {
  assert.equal(deadline.assessmentDueDateProblem('2026-11-03', NOW), '');
  assert.equal(deadline.assessmentDueDateProblem('2026-11-02', NOW), '');
  assert.match(deadline.assessmentDueDateProblem('2026-11-01', NOW), /at least one full day/);
  assert.match(deadline.assessmentDueDateProblem('2026-10-01', NOW), /at least one full day/);
  assert.match(deadline.assessmentDueDateProblem('2027-06-01', NOW), /at most 90 days/);
  assert.match(deadline.assessmentDueDateProblem('', NOW), /Choose a deadline/);
});

test('only an assessment waiting for an answer can be overdue', () => {
  const due = '2026-11-03T15:59:00.000Z';
  const before = Date.parse('2026-11-03T10:00:00Z');
  const after = Date.parse('2026-11-04T00:00:00Z');
  assert.equal(deadline.assessmentDueState({ status: 'pending', dueAt: due }, before), 'open');
  assert.equal(deadline.assessmentDueState({ status: 'pending', dueAt: due }, after), 'overdue');
  assert.equal(deadline.assessmentDueState({ status: 'submitted', dueAt: due }, after), 'none');
  assert.equal(deadline.assessmentDueState({ status: 'pending', dueAt: null }, after), 'none');
  assert.equal(deadline.assessmentDueState(null, after), 'none');
});

test('candidates are shown the deadline, or that it has passed', () => {
  const pending = { status: 'pending', dueAt: '2026-11-03T15:59:00.000Z' };
  assert.equal(deadline.candidateAssessmentNote(pending, Date.parse('2026-11-01T00:00:00Z')), 'Action required · due Nov 3, 2026');
  assert.equal(deadline.candidateAssessmentNote(pending, Date.parse('2026-11-05T00:00:00Z')), 'Deadline passed on Nov 3, 2026');
  assert.equal(deadline.candidateAssessmentNote({ status: 'pending', dueAt: null }), 'Action required');
  assert.equal(deadline.candidateAssessmentNote({ status: 'submitted', dueAt: pending.dueAt }), 'Submitted');
  assert.equal(deadline.assessmentDueLabel(pending, Date.parse('2026-11-01T00:00:00Z')), 'Due Nov 3, 2026');
});

test('every way of sending an assessment lets the employer set the deadline', () => {
  const api = read('../src/lib/assessmentApi.ts');
  assert.match(api, /requested_due_at: dueAt \?\? null/);
  const dashboard = read('../src/pages/EmployerDashboard.tsx');
  const candidates = read('../src/pages/employer/EmployerCandidatesPage.tsx');
  const review = read('../src/pages/employer/ApplicantReviewModal.tsx');
  for (const page of [dashboard, candidates, review]) assert.match(page, /<AssessmentDeadlineField/);
  assert.match(dashboard, /useState\(\(\) => defaultAssessmentDueDate\(\)\)/);
  assert.match(dashboard, /sendAssessments\(\[target\.id\], assessmentDueDate\)/);
  assert.match(candidates, /onBulkAction\(pending\.action,.*rejectionReason, dueDate\)/);
});

test('the deadline is shown to the candidate on Home, Applications and in the assessment', () => {
  assert.match(read('../src/pages/candidate/HomePage.tsx'), /assessmentsDue\.length > 0/);
  assert.match(read('../src/pages/candidate/ApplicationsPage.tsx'), /candidateAssessmentNote/);
  const modal = read('../src/pages/candidate/CandidateAssessmentModal.tsx');
  assert.match(modal, /Due \{formatAssessmentDue\(assessment\.dueAt, true\)\}/);
  assert.match(modal, /passed on/);
});
