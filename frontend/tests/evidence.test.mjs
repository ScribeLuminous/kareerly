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
  assert.equal(calls.length, 3, 'Only explicit save, delete and loading the saved records may update evidence; re-analysis must leave it intact');
  for (const call of calls) assert.doesNotMatch(call.getText(ast), /certifications|Indicators|candidate_profile/);
  assert.match(dashboard, /await prepareEvidenceUpload\(draft, existingRecord, validateCertificateFile\)/);
  // Skill proof opens the same validated evidence modal (course or skill prefilled).
  assert.match(dashboard, /onAddSkillProof=\{openSkillEvidenceUpload\}/);
  assert.match(dashboard, /const openSkillEvidenceUpload = [\s\S]*?setEvidenceModalOpen\(true\)/);
  assert.match(dashboard, /useState<EvidenceUploadRecord\[\]>\(\[\]\)/);
});

// ---------- Certificate links (Credly and similar) ----------
const verified = { status: 'verified', url: 'https://www.credly.com/badges/d6edaf38-1ed2-418c-9ecd-f6913acdc0f2/public_url', provider: 'Credly', message: 'Credly badge found.', badge_name: 'Data Analytics Certificate', issuer: 'Example Academy' };
const link = { credentialUrl: verified.url, credentialCheck: verified };

test('a checked certificate link is enough proof without a PDF, and stays pending review', async () => {
  const record = await prepareEvidenceUpload({ ...draft, ...link }, undefined, validate);
  assert.equal(record.credentialUrl, verified.url);
  assert.equal(record.credentialStatus, 'verified');
  assert.equal(record.badgeName, 'Data Analytics Certificate');
  assert.equal(record.issuer, 'Example Academy');
  assert.equal(record.fileName, undefined);
  // Finding the badge page is not enough: it must name this candidate.
  assert.equal(record.status, 'Pending Verification');
});

test('a Credly badge issued to the candidate is verified automatically, unless a PDF rides along', async () => {
  const mine = { ...verified, recipient: 'Juan Dela Cruz', recipient_match: true };
  const record = await prepareEvidenceUpload({ ...draft, credentialUrl: verified.url, credentialCheck: mine }, undefined, validate);
  assert.equal(record.status, 'Verified');
  const other = await prepareEvidenceUpload({ ...draft, credentialUrl: verified.url, credentialCheck: { ...mine, recipient_match: false } }, undefined, validate);
  assert.equal(other.status, 'Pending Verification');
  const withPdf = await prepareEvidenceUpload({ ...draft, file: new File(['%PDF-1.4'], 'c.pdf', { type: 'application/pdf' }), credentialUrl: verified.url, credentialCheck: mine }, undefined, validate);
  assert.equal(withPdf.status, 'Pending Verification');
});

test('a link that does not point to a real badge is refused and the old record is kept', async () => {
  for (const status of ['not_found', 'invalid']) {
    await assert.rejects(
      prepareEvidenceUpload({ ...draft, credentialUrl: 'https://www.credly.com/badges/x', credentialCheck: { ...verified, status, message: 'Credly has no badge at this link.' } }, undefined, validate),
      /no badge at this link/,
    );
  }
  const existing = await prepareEvidenceUpload({ ...draft, ...link }, undefined, validate);
  const snapshot = structuredClone(existing);
  await assert.rejects(prepareEvidenceUpload({ ...draft, id: existing.id, credentialUrl: 'x', credentialCheck: { ...verified, status: 'not_found', message: 'nope' } }, existing, validate), /nope/);
  assert.deepEqual(existing, snapshot);
});

test('a link that could not be checked is kept as unchecked, and a link with no check result is refused', async () => {
  const record = await prepareEvidenceUpload({ ...draft, credentialUrl: verified.url, credentialCheck: { ...verified, status: 'unreachable', message: 'saved unchecked' } }, undefined, validate);
  assert.equal(record.credentialStatus, 'unreachable');
  await assert.rejects(prepareEvidenceUpload({ ...draft, credentialUrl: verified.url }, undefined, validate), /could not be checked/);
});

test('with neither a PDF nor a link nothing is saved, and a PDF and a link can be kept together', async () => {
  await assert.rejects(prepareEvidenceUpload({ ...draft }, undefined, validate), /upload a PDF evidence file or add a certificate link/);
  const both = await prepareEvidenceUpload({ ...draft, file: pdf, ...link }, undefined, validate);
  assert.equal(both.fileName, 'course.pdf');
  assert.equal(both.credentialUrl, verified.url);
  URL.revokeObjectURL(both.fileUrl);
  // Replacing only the notes keeps the stored link.
  const kept = await prepareEvidenceUpload({ ...draft, id: both.id, notes: 'updated' }, both, validate);
  assert.equal(kept.credentialUrl, verified.url);
});

test('the dashboard checks a certificate link before it can become proof', () => {
  const dashboard = readCandidateSource();
  const save = dashboard.slice(dashboard.indexOf('const nextRecord = await prepareEvidenceUpload') - 400, dashboard.indexOf('const nextRecord = await prepareEvidenceUpload'));
  assert.match(save, /await checkCredentialLink\(/);
  assert.match(dashboard, /const target = record\.fileUrl \|\| record\.credentialUrl;/);
});
