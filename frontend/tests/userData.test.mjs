import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText).toString('base64');
}

const source = fs.readFileSync(new URL('../src/lib/userData.ts', import.meta.url), 'utf8')
  .replace("import { supabase } from './supabase';", 'const supabase = globalThis.userDataTestSupabase;');

test('a failed resume row rolls back its uploaded file and rejects', async () => {
  const removed = [];
  globalThis.userDataTestSupabase = {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
      }),
    },
    from: (table) => ({
      insert: () => table === 'resumes'
        ? { select: () => ({ single: async () => ({ data: null, error: { message: 'permission denied' } }) }) }
        : Promise.resolve({ error: null }),
    }),
  };
  const userData = await import(moduleUrl(source));
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      userData.saveResumeAnalysis({
        userId: 'candidate-1',
        fileName: 'resume.pdf',
        file: new File(['resume'], 'resume.pdf', { type: 'application/pdf' }),
        analysis: { normalized_for_matching: { resume_text_for_matching: 'SQL developer' }, candidate_profile: { skills: [] } },
      }),
      /Unable to save the resume to your profile: permission denied/,
    );
    assert.equal(removed.length, 1);
    assert.match(removed[0], /^candidate-1\//);
  } finally {
    console.warn = originalWarn;
    delete globalThis.userDataTestSupabase;
  }
});

// Each data: URL is cached, so give every import its own source to pick up its stub.
let freshImportCount = 0;
const importFresh = () => import(moduleUrl(`${source}\n// ${freshImportCount += 1}`));

function matchHistoryStub(rows, calls) {
  return {
    from: () => {
      const filters = {};
      const query = {
        select: () => query,
        eq: (column, value) => { filters[column] = value; return query; },
        is: (column, value) => { filters[column] = value; return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          calls.push({ ...filters });
          const row = rows.find((item) => item.user_id === filters.user_id && item.resume_id === filters.resume_id);
          return { data: row ? { results_json: row.results_json } : null, error: null };
        },
      };
      return query;
    },
  };
}

test('saved matches for the latest resume are restored after a reload', async () => {
  const calls = [];
  globalThis.userDataTestSupabase = matchHistoryStub([
    { user_id: 'candidate-1', resume_id: 'resume-old', results_json: { fit_now_matches: ['old'] } },
    { user_id: 'candidate-1', resume_id: 'resume-new', results_json: { fit_now_matches: ['new'] } },
  ], calls);
  try {
    const userData = await importFresh();
    const restored = await userData.loadLatestMatchHistory({ userId: 'candidate-1', resumeId: 'resume-new' });
    assert.deepEqual(restored, { fit_now_matches: ['new'] });
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.userDataTestSupabase;
  }
});

test('an older resume\'s matches are skipped; only rows without a resume id are used as fallback', async () => {
  const calls = [];
  globalThis.userDataTestSupabase = matchHistoryStub([
    { user_id: 'candidate-1', resume_id: 'resume-old', results_json: { fit_now_matches: ['old'] } },
    { user_id: 'candidate-1', resume_id: null, results_json: { fit_now_matches: ['legacy'] } },
  ], calls);
  try {
    const userData = await importFresh();
    const restored = await userData.loadLatestMatchHistory({ userId: 'candidate-1', resumeId: 'resume-new' });
    assert.deepEqual(restored, { fit_now_matches: ['legacy'] });
    assert.deepEqual(calls.map((call) => call.resume_id), ['resume-new', null]);
  } finally {
    delete globalThis.userDataTestSupabase;
  }
});

test('re-scanning a stored resume saves the new analysis without a second copy of the file', async () => {
  const uploads = [];
  const removed = [];
  const inserted = [];
  const stub = (rowError) => ({
    storage: {
      from: () => ({
        upload: async (path) => { uploads.push(path); return { error: null }; },
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
      }),
    },
    from: (table) => ({
      insert: (row) => {
        if (table !== 'resumes') return Promise.resolve({ error: null });
        inserted.push(row);
        return { select: () => ({ single: async () => (rowError ? { data: null, error: { message: rowError } } : { data: { id: 'resume-2' }, error: null }) }) };
      },
    }),
  });
  const existingFile = { bucket: 'resumes', path: 'candidate-1/old.pdf', name: 'old.pdf', mimeType: 'application/pdf', size: 1234 };
  const input = {
    userId: 'candidate-1',
    fileName: 'old.pdf',
    file: new File(['resume'], 'old.pdf', { type: 'application/pdf' }),
    existingFile,
    analysis: { normalized_for_matching: { resume_text_for_matching: 'Zendesk' }, candidate_profile: { skills: [] } },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    globalThis.userDataTestSupabase = stub(null);
    const saved = await (await importFresh()).saveResumeAnalysis(input);
    assert.equal(saved, 'resume-2');
    assert.deepEqual(uploads, []);
    assert.equal(inserted[0].storage_path, 'candidate-1/old.pdf');
    assert.equal(inserted[0].file_size_bytes, 6);

    // A failed save must never delete the stored original.
    globalThis.userDataTestSupabase = stub('permission denied');
    await assert.rejects((await importFresh()).saveResumeAnalysis(input), /permission denied/);
    assert.deepEqual(removed, []);

    // Another user's path is never reused; the file is uploaded to this user's folder instead.
    globalThis.userDataTestSupabase = stub(null);
    await (await importFresh()).saveResumeAnalysis({ ...input, existingFile: { ...existingFile, path: 'someone-else/old.pdf' } });
    assert.equal(uploads.length, 1);
    assert.match(uploads[0], /^candidate-1\//);
  } finally {
    console.warn = originalWarn;
    delete globalThis.userDataTestSupabase;
  }
});
