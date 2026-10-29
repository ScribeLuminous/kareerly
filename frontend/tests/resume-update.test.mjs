import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readCandidateSource } from './helpers/candidateSource.mjs';

const dashboard = readCandidateSource();
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

test('a resume that is analysed but not saved leaves the profile education alone', () => {
  const analyze = dashboard.slice(
    dashboard.indexOf('const analyzeResumeForModal'),
    dashboard.indexOf('const addSkillToReview'),
  );
  assert.doesNotMatch(analyze, /saveCandidateAccountSettings/);
  assert.doesNotMatch(analyze, /setProfileForm/);
  const save = dashboard.slice(
    dashboard.indexOf('const savePendingResume'),
    dashboard.indexOf('const confirmSkillsAndRefresh'),
  );
  assert.ok(save.indexOf('await saveResumeAnalysis') < save.indexOf('await applyExtractedEducation'));
});

test('replacing the confirmed skills writes the new set before removing the old one', () => {
  const replace = dashboard.slice(
    dashboard.indexOf('The new set is written before the old one is removed'),
    dashboard.indexOf('Unable to save confirmed skills'),
  );
  assert.ok(replace.indexOf(".insert(") < replace.indexOf(".delete()"));
  assert.doesNotMatch(replace, /delete\(\)\.eq\('user_id', currentUser\.id\);/);
});

test('the resume preview fills the dialog, offers a download and explains a failed load', () => {
  assert.match(dashboard, /size="xl"/);
  assert.match(dashboard, /headerActions=/);
  assert.match(dashboard, /download=\{resumePreview\.name\}/);
  assert.match(dashboard, /could not be found\. It may have been moved or deleted/);
  assert.match(dashboard, /Try again/);
});
