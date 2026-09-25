import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText).toString('base64');
}

const freshness = await import(moduleUrl(fs.readFileSync(new URL('../src/lib/resumeFreshness.ts', import.meta.url), 'utf8')));
const fileUtils = await import(moduleUrl(fs.readFileSync(new URL('../src/lib/fileUtils.ts', import.meta.url), 'utf8')));

test('the frontend parser version matches the backend', () => {
  const backend = fs.readFileSync(new URL('../../backend/app/services/resume_parser.py', import.meta.url), 'utf8');
  const version = backend.match(/^RESUME_PARSER_VERSION = "([^"]+)"/m)?.[1];
  assert.equal(freshness.CURRENT_RESUME_PARSER_VERSION, version);
});

test('an analysis saved before the current reader is stale, never shown as new', () => {
  const old = freshness.assessSavedResume({ created_at: '2026-08-01T00:00:00Z', extracted_profile_json: { candidate_profile: {} } });
  assert.deepEqual(old, { stale: true, analyzedAt: '2026-08-01T00:00:00Z', parserVersion: null });
  const current = freshness.assessSavedResume({
    created_at: '2026-09-25T00:00:00Z',
    extracted_profile_json: { extraction: { parser_version: freshness.CURRENT_RESUME_PARSER_VERSION } },
  });
  assert.equal(current.stale, false);
  assert.equal(freshness.assessSavedResume(null), null);
  // An older live reader produced it, so uploading again would give the same result.
  const fromOldBackend = { created_at: '2026-09-25T00:00:00Z', extracted_profile_json: { candidate_profile: {} } };
  assert.equal(freshness.assessSavedResume(fromOldBackend, null).stale, false);
  assert.equal(freshness.assessSavedResume(fromOldBackend, freshness.CURRENT_RESUME_PARSER_VERSION).stale, true);
});

test('the stale notice offers a re-scan only when the original file is stored', () => {
  const record = { stale: true, analyzedAt: null, parserVersion: null };
  assert.match(freshness.staleResumeMessage(record, true), /older scan.*Re-scan your saved resume/s);
  assert.match(freshness.staleResumeMessage(record, false), /older scan.*Upload your resume again/s);
});

test('reading problems are shown once each', () => {
  assert.deepEqual(freshness.extractionWarnings({ extraction_warnings: ['OCR failed.', ' OCR failed.', ''] }), ['OCR failed.']);
  assert.deepEqual(freshness.extractionWarnings(null), []);
});

test('PDF, DOCX and DOC resumes are accepted up to 5MB', () => {
  const file = (name, type, size = 10) => ({ name, type, size });
  assert.equal(fileUtils.validateResumeFile(file('a.pdf', 'application/pdf')).valid, true);
  assert.equal(fileUtils.validateResumeFile(file('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).valid, true);
  assert.equal(fileUtils.validateResumeFile(file('a.doc', 'application/msword')).valid, true);
  // Some browsers give .doc files no type at all.
  assert.equal(fileUtils.validateResumeFile(file('a.doc', '')).valid, true);
  assert.equal(fileUtils.validateResumeFile(file('a.txt', 'text/plain')).valid, false);
  assert.equal(fileUtils.validateResumeFile(file('a.pdf', 'application/msword')).valid, false);
  assert.equal(fileUtils.validateResumeFile(file('a.pdf', 'application/pdf', 5 * 1024 * 1024 + 1)).valid, false);
});
