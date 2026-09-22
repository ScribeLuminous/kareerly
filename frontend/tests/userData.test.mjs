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
