import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/pages/ExternalJobAnalysisPage.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/pages/candidate-dashboard-v5.css', import.meta.url), 'utf8');

test('external analysis keeps result actions contextual and removes the bottom toolbar', () => {
  const resultHeaderStart = pageSource.indexOf('className="external-result-header"');
  const skillsStart = pageSource.indexOf('className="external-section external-skills-section"');
  const learningStart = pageSource.indexOf('className="external-section external-learning-section"');
  const noticeStart = pageSource.indexOf('className="external-info-notice"');

  assert.ok(resultHeaderStart > 0);
  assert.ok(pageSource.indexOf("'Save Match'", resultHeaderStart) < skillsStart);
  assert.ok(pageSource.indexOf("'Download'", resultHeaderStart) < skillsStart);
  assert.ok(pageSource.indexOf('Analyze another job', resultHeaderStart) < skillsStart);
  assert.ok(pageSource.indexOf('View recommendations', learningStart) < noticeStart);
  assert.equal((pageSource.match(/View recommendations/g) || []).length, 1);
  assert.doesNotMatch(pageSource, /Saved to Profile|Download Match Report|View Learning Recommendations/);
});

test('saved analyses are a responsive right rail and skills share one section', () => {
  assert.match(cssSource, /\.external-analysis-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 320px\)/s);
  assert.match(cssSource, /@media \(max-width: 1100px\)[\s\S]*?\.external-analysis-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(cssSource, /\.external-saved-rail\s*\{[^}]*position:\s*sticky/s);
  assert.equal((pageSource.match(/external-skills-section/g) || []).length, 1);
  assert.match(pageSource, /SKILL_PREVIEW_COUNT = 6/);
});

test('icon-only saved-analysis controls have accessible names and usable hit areas', () => {
  assert.match(pageSource, /aria-label={`Actions for \$\{saved\.job_title/);
  assert.match(pageSource, /title="Saved analysis actions"/);
  assert.match(cssSource, /\.external-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/s);
});
