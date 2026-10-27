import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const assessment = read('../src/pages/candidate/CandidateAssessmentModal.tsx');
const messages = read('../src/pages/candidate/MessagesPage.tsx');
const review = read('../src/pages/employer/ApplicantReviewModal.tsx');
const employer = read('../src/pages/EmployerDashboard.tsx');
const candidates = read('../src/pages/employer/EmployerCandidatesPage.tsx');
const model = read('../src/pages/employer/model.ts');

test('submitting a Candidate Assessment asks for confirmation first', () => {
  assert.match(assessment, /onClick=\{askToSubmit\}>Submit Assessment/);
  assert.doesNotMatch(assessment, /onClick=\{\(\) => void save\(true\)\}/);
  assert.match(assessment, /can't change them/);
  // Required answers are checked before the dialog opens.
  const ask = assessment.slice(assessment.indexOf('const askToSubmit'), assessment.indexOf('const save'));
  assert.ok(ask.indexOf('required && !answers') < ask.indexOf('setConfirmingSubmit(true)'));
});

test('Hired and Rejected are confirmed, one at a time and in bulk, and say they are final', () => {
  assert.match(employer, /<ConfirmDialog\s+title=\{`\$\{statusActionLabel\(confirmModal\.action\)\}\?`\}/);
  assert.match(candidates, /CANDIDATE_BULK_LABEL\[pending\.action\]/);
  assert.match(model, /Hired is final/);
  assert.match(model, /Rejecting this applicant is a final decision/);
  // The review modal only opens the confirmation; it never changes the stage directly.
  assert.doesNotMatch(review, /updateEmployerApplicationStatus/);
});

test('other irreversible actions are confirmed', () => {
  assert.match(messages, /setPendingChoice\('decline'\)/);
  assert.doesNotMatch(messages, /onClick=\{onDecline\}/);
  assert.match(review, /setConfirming\('send'\)/);
  assert.match(review, /setConfirming\('extend'\)/);
  assert.match(review, /setConfirming\('scorecard'\)/);
  assert.match(review, /Approve and submit/);
});
