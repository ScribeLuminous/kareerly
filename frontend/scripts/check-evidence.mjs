import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Dashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleEvidenceSave') handler = node.initializer.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
    assert.ok(!node.getText(ast).includes('setEvidenceRecords'), 'Resume/profile effects must not create or replace upload records');
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler);
let records = [];
let rejectUpload = false;
const context = vm.createContext({
  evidenceRecords: records, showToast: () => {}, setLoading: () => {}, setError: () => {},
  setEvidenceModalOpen: () => {}, setEditingEvidence: () => {},
  validateCertificateFile: async () => { if (rejectUpload) throw new Error('Invalid file'); return {message: 'Pending verification'}; },
  URL: {createObjectURL: () => 'blob:test-upload'}, dateTodayIso: () => '2026-09-14',
  setEvidenceRecords: updater => { records = updater(records); context.evidenceRecords = records; },
});
const code = ts.transpileModule(`const save = ${handler};`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
vm.runInContext(code, context);
const save = vm.runInContext('save', context);
const draft = {title: 'Training certificate', evidenceType: 'Certificate', relatedSkill: 'SQL', category: 'Technology', file: null};
await save(draft);
assert.equal(records.length, 0, 'No file must not create evidence');
await save({...draft, file: {name: 'certificate.pdf', type: 'application/pdf', size: 100}});
assert.equal(records.length, 1);
assert.equal(records[0].status, 'Pending Verification');
assert.equal(records[0].fileUrl, 'blob:test-upload');
rejectUpload = true;
await save({...draft, file: {name: 'invalid.pdf', type: 'application/pdf', size: 100}});
assert.equal(records.length, 1, 'Failed validation must preserve existing uploads');
await save({...draft, id: records[0].id, title: 'Updated title'});
assert.equal(records.length, 1);
assert.equal(records[0].title, 'Updated title');
assert.equal(records[0].status, 'Pending Verification');
console.log('Evidence checks passed: no resume-derived rows, explicit upload required, failed validation preserves records, uploads remain pending.');
