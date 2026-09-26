import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { readCandidateSource } from './helpers/candidateSource.mjs';
const source = fs.readFileSync(new URL('../src/lib/evidence.ts', import.meta.url), 'utf8');
const { prepareEvidenceUpload } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64'));
const draft = { title: 'Course', evidenceType: 'Certificate', relatedSkill: 'SQL', category: 'Technical', file: null };
const pdf = new File(['%PDF /Type /Page'], 'course.pdf', { type: 'application/pdf' });
const validate = async () => ({ status: 'valid', message: 'PDF checks passed' });
test('parsed resume certifications cannot create evidence without a file', async () => {
  for (const fields of [{ certifications: [{ title: 'SQL' }] }, { certification_indicators: ['SQL'], education_indicators: ['Degree'], experience_indicators: ['Developer'] }, {}]) {
    await assert.rejects(prepareEvidenceUpload({ ...draft, ...fields }, undefined, validate), /upload a PDF/);
  }
});
test('successful upload is Pending Verification', async () => {
  const record = await prepareEvidenceUpload({ ...draft, file: pdf }, undefined, validate);
  assert.equal(record.status, 'Pending Verification');
  assert.equal(record.fileName, 'course.pdf');
  URL.revokeObjectURL(record.fileUrl);
});
test('failed validation preserves existing records, including replacement attempts', async () => {
  const existing = await prepareEvidenceUpload({ ...draft, file: pdf }, undefined, validate);
  const snapshot = structuredClone(existing);
  for (const check of [async () => { throw new Error('Rejected'); }, async () => ({ status: 'invalid', message: 'Rejected' })]) {
    await assert.rejects(prepareEvidenceUpload({ ...draft, id: existing.id, file: pdf }, existing, check), /Rejected/);
    assert.deepEqual(existing, snapshot);
  }
  URL.revokeObjectURL(existing.fileUrl);
});
test('dashboard has no resume-driven evidence setter or alternate unvalidated upload path', () => {
  const dashboard = readCandidateSource();
  const ast = ts.createSourceFile('Dashboard.tsx', dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'setEvidenceRecords') calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(calls.length, 2, 'Only explicit save and delete may update evidence; re-analysis must leave it intact');
  for (const call of calls) assert.doesNotMatch(call.getText(ast), /certifications|Indicators|candidate_profile/);
  assert.match(dashboard, /await prepareEvidenceUpload\(draft, existingRecord, validateCertificateFile\)/);
  assert.match(dashboard, /onUploadSkillEvidence=\{openEvidenceUploadModal\}/);
  assert.match(dashboard, /useState<EvidenceUploadRecord\[\]>\(\[\]\)/);
});
