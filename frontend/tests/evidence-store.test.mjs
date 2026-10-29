import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Certificates and proof are saved per user (src/lib/evidenceStore.ts), so a
// link-only badge is still there after a reload.

const source = fs.readFileSync(new URL('../src/lib/evidenceStore.ts', import.meta.url), 'utf8')
  .replace("import { supabase } from './supabase';", 'const supabase = { from: (table) => globalThis.evidenceTestSupabase.from(table) };')
  .replace(/^import type .*$/m, '');
const store = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));

function fakeDatabase() {
  const rows = [];
  globalThis.evidenceTestSupabase = {
    from(table) {
      assert.equal(table, 'candidate_evidence');
      const filters = [];
      const q = {
        select() { return q; },
        order() { return q; },
        eq(column, value) { filters.push([column, value]); return q; },
        delete() { q.op = 'delete'; return q; },
        upsert(row) {
          const at = rows.findIndex((item) => item.id === row.id);
          if (at >= 0) rows[at] = { ...row }; else rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          const match = (row) => filters.every(([c, v]) => row[c] === v);
          if (q.op === 'delete') {
            for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i])) rows.splice(i, 1);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows.filter(match).map((r) => ({ ...r })), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return rows;
}

const link = {
  id: '11111111-1111-1111-1111-111111111111', title: 'Artificial Intelligence', evidenceType: 'Certificate', relatedSkill: 'Ai', category: 'Ai',
  uploadedAt: '2026-10-28', notes: '', credentialUrl: 'https://www.credly.com/badges/d6edaf38-1ed2-418c-9ecd-f6913acdc0f2', credentialProvider: 'Credly',
  credentialStatus: 'verified', badgeName: 'AI Fundamentals', issuer: 'IBM SkillsBuild', status: 'Pending Verification',
};

test('a link-only badge is still there after a reload', async () => {
  fakeDatabase();
  await store.saveEvidence('user-a', link);
  const [loaded] = await store.loadEvidence('user-a');
  assert.deepEqual(loaded, { ...link, fileName: undefined });
});

test('saving again updates the record, and users only see their own', async () => {
  fakeDatabase();
  await store.saveEvidence('user-a', link);
  await store.saveEvidence('user-a', { ...link, status: 'Verified' });
  await store.saveEvidence('user-b', { ...link, id: '22222222-2222-2222-2222-222222222222' });
  const mine = await store.loadEvidence('user-a');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'Verified');
});

test('a PDF record keeps its file name but never a blob address, and a refused link status is not written', async () => {
  const rows = fakeDatabase();
  await store.saveEvidence('user-a', { ...link, fileName: 'cert.pdf', fileUrl: 'blob:http://x/1', credentialStatus: 'not_found' });
  assert.equal(rows[0].file_name, 'cert.pdf');
  assert.equal(JSON.stringify(rows[0]).includes('blob:'), false);
  assert.equal(rows[0].credential_status, null);
  const [loaded] = await store.loadEvidence('user-a');
  assert.equal(loaded.fileUrl, undefined);
});

test('delete removes only that record, and the dashboard saves before it shows a record', async () => {
  fakeDatabase();
  await store.saveEvidence('user-a', link);
  await store.deleteEvidence('user-a', link.id);
  assert.deepEqual(await store.loadEvidence('user-a'), []);
  const dashboard = fs.readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /await saveEvidence\(currentUser\.id, nextRecord\)[\s\S]*?setEvidenceRecords/);
  assert.match(dashboard, /loadEvidence\(userId\)/);
});
