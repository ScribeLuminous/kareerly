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
