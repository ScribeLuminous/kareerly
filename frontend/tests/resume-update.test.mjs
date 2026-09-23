import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
const survey = fs.readFileSync(new URL('../src/components/SurveyStep.tsx', import.meta.url), 'utf8');
const upload = fs.readFileSync(new URL('../src/components/UploadZone.tsx', import.meta.url), 'utf8');

test('resume analysis is reused for one text matching request', () => {
  assert.doesNotMatch(dashboard, /runMatchesFromResume/);
  assert.doesNotMatch(survey, /runMatchesFromResume/);
  assert.match(dashboard, /confirmed_skills: confirmedSkillRecords/);
  assert.match(survey, /confirmed_skills: selectedSkills/);
});

test('every signed-in resume path saves before advancing', () => {
  const sharedSave = dashboard.slice(
    dashboard.indexOf('const savePendingResume'),
    dashboard.indexOf('const confirmSkillsAndRefresh'),
  );
  const reviewPath = dashboard.slice(
    dashboard.indexOf('const goToOnboardingSkillsAndPreferences'),
    dashboard.indexOf('const handleEvidenceSave'),
  );
  assert.match(sharedSave, /await saveResumeAnalysis/);
  assert.match(sharedSave, /if \(savedResumeUploadId\.current\) return savedResumeUploadId\.current/);
  assert.ok(reviewPath.indexOf('await savePendingResume()') < reviewPath.indexOf('onUpdateResume()'));

  for (const [action, next] of [
    ['confirmSkillsAndRefresh', 'skipResumeReviewAndRefresh'],
    ['skipResumeReviewAndRefresh', 'goToOnboardingSkillsAndPreferences'],
  ]) {
    const path = dashboard.slice(dashboard.indexOf(`const ${action}`), dashboard.indexOf(`const ${next}`));
    assert.ok(path.indexOf('await savePendingResume()') < path.indexOf('await runMatchingWithSkills('));
  }

  const initialUpload = upload.slice(upload.indexOf('const handleContinue'), upload.indexOf('const handleRemoveFile'));
  assert.ok(initialUpload.indexOf('await saveResumeAnalysis') < initialUpload.indexOf('setResumeAnalysis(analysis)'));
});

test('resume decision actions have concise labels and accessible icon-only back', () => {
  const modal = dashboard.slice(dashboard.indexOf('function ResumeUpdateModal'), dashboard.indexOf('function ', dashboard.indexOf('function ResumeUpdateModal') + 9));
  assert.match(modal, /Skills & Preferences/);
  assert.match(modal, /Skip & Apply/);
  assert.match(modal, /aria-label="Back to upload"/);
  assert.doesNotMatch(modal, />Back to Upload</);
});
