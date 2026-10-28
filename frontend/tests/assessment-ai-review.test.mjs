import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const panels = read('../src/pages/employer/EvaluationPanels.tsx');
const modal = read('../src/pages/employer/ApplicantReviewModal.tsx');
const api = read('../src/lib/assessmentApi.ts');

test('the AI draft only pre-fills criteria the reviewer has not rated', () => {
  const draft = panels.slice(panels.indexOf('const draftWithAi'), panels.indexOf('// Only the rating changes here'));
  assert.match(draft, /mine\.rating === null && !mine\.evidence\.trim\(\)/);
  assert.match(draft, /setSummary\(\(current\) => current\.trim\(\) \? current : draft\.summary\)/);
});

test('a drafted review needs the reviewer to approve and submit it', () => {
  assert.match(panels, /Approve and submit scorecard/);
  assert.match(panels, /AI draft\. Not your evaluation yet\./);
  // Asking for a draft never saves anything.
  assert.doesNotMatch(api.slice(api.indexOf('export async function requestAiReviewDraft')), /save_evaluation_scorecard/);
  assert.match(modal, /if \(submit && aiDrafted\)/);
  assert.match(api, /rpc\('approve_assessment_ai_draft'/);
});

test('links in the answers are shown to the reviewer and are not claimed as checked', () => {
  assert.match(panels, /not opened by the AI/);
  assert.match(panels, /rel="noopener noreferrer"/);
});

test('manual rating still works when the AI is unavailable', () => {
  assert.match(modal, /You can still rate the answers yourself/);
  assert.match(modal, /return null;/);
});

test('an employer can turn AI drafting off per job, and nothing is offered or sent when it is off', () => {
  const editor = read('../src/pages/employer/JobEditorPage.tsx');
  const dashboard = read('../src/pages/EmployerDashboard.tsx');
  assert.match(editor, /Let AI draft a first-pass review/);
  assert.match(dashboard, /ai_review_enabled: jobForm\.aiReview !== 'off'/);
  assert.match(dashboard, /'ai_review_enabled'\] as const/);
  assert.match(modal, /aiAvailable=\{job\?\.aiReviewEnabled !== false\}/);
  assert.match(panels, /!disabled && aiAvailable && \(/);
});

test('candidates are told AI may assist and what is not sent to it', () => {
  const candidateModal = read('../src/pages/candidate/CandidateAssessmentModal.tsx');
  assert.match(candidateModal, /may use an AI tool to draft a first-pass review/);
  assert.match(candidateModal, /emails, phone numbers and links are not sent/);
});
