import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/answerLinks.ts', import.meta.url), 'utf8');
const { splitAnswerLinks, linksIn } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('links in an answer become links and the sentence punctuation stays text', () => {
  const parts = splitAnswerLinks('See https://example.com/work, and (https://example.org/a).');
  assert.deepEqual(parts.filter((part) => part.type === 'link').map((part) => part.value), ['https://example.com/work', 'https://example.org/a']);
  assert.equal(parts.map((part) => part.value).join(''), 'See https://example.com/work, and (https://example.org/a).');
});

test('only web links are made clickable', () => {
  assert.deepEqual(linksIn(['javascript:alert(1) and ftp://x.test/a and data:text/html,hi']), []);
  assert.deepEqual(linksIn(['https://a.test', 'again https://a.test and http://b.test/x']), ['https://a.test', 'http://b.test/x']);
  assert.deepEqual(splitAnswerLinks('no links here'), [{ type: 'text', value: 'no links here' }]);
});

test('the review form opens answer links safely and reports each open to the activity history', () => {
  const panels = read('../src/pages/employer/EvaluationPanels.tsx');
  assert.match(panels, /rel="noopener noreferrer nofollow"/);
  assert.match(panels, /target="_blank"/);
  assert.match(panels, /onClick=\{\(\) => onLinkOpened\?\.\(part\.value\)\}/);
  assert.match(panels, /Not opened yet/);
  assert.match(panels, /assessment_link_opened:/);
  const modal = read('../src/pages/employer/ApplicantReviewModal.tsx');
  assert.match(modal, /logAssessmentLinkOpened\(assessment\.id, url\)/);
  assert.match(read('../src/lib/assessmentApi.ts'), /rpc\('log_assessment_link_opened'/);
});
