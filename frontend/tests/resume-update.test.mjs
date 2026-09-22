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
  const reviewPath = dashboard.slice(
    dashboard.indexOf('const goToOnboardingSkillsAndPreferences'),
    dashboard.indexOf('const handleEvidenceSave'),
  );
  assert.ok(reviewPath.indexOf('await saveResumeAnalysis') < reviewPath.indexOf('onUpdateResume()'));

  const initialUpload = upload.slice(upload.indexOf('const handleContinue'), upload.indexOf('const handleRemoveFile'));
  assert.ok(initialUpload.indexOf('await saveResumeAnalysis') < initialUpload.indexOf('setResumeAnalysis(analysis)'));
});
