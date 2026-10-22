import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Message reports, match-score disclaimers, and load failures that must show an
// error instead of an empty (wrong) result.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText).toString('base64');
}

const userDataSource = read('../src/lib/userData.ts')
  .replace("import { supabase } from './supabase';", 'const supabase = globalThis.reviewFixesSupabase;');
let importCount = 0;
const importUserData = () => import(moduleUrl(`${userDataSource}\n// ${importCount += 1}`));

function failingQuery(message) {
  const query = {
    select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: null, error: { message } }),
  };
  return { from: () => query };
}

async function withQuietStub(stub, run) {
  globalThis.reviewFixesSupabase = stub;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await run(await importUserData());
  } finally {
    console.warn = originalWarn;
    delete globalThis.reviewFixesSupabase;
  }
}

test('a failed resume read rejects instead of looking like "no resume"', async () => {
  await withQuietStub(failingQuery('network down'), async (userData) => {
    await assert.rejects(userData.loadLatestResume({ userId: 'candidate-1' }), /Unable to load your saved resume: network down/);
  });
});

test('a failed match-history read rejects instead of looking like "no matches"', async () => {
  await withQuietStub(failingQuery('timeout'), async (userData) => {
    await assert.rejects(userData.loadLatestMatchRun({ userId: 'candidate-1', resumeId: 'r1' }), /Unable to load your saved matches: timeout/);
  });
});

test('the dashboard shows restore and saved-job load failures with a retry', () => {
  const dashboard = read('../src/pages/Dashboard.tsx');
  assert.match(dashboard, /setRestoreError\(/);
  assert.match(dashboard, /setRestoreAttempt\(\(count\) => count \+ 1\)/);
  assert.match(dashboard, /setSavedJobsError\('Your saved jobs could not be loaded\.'\)/);
  // Message refresh failures keep the last messages instead of emptying the thread.
  assert.doesNotMatch(dashboard, /loadApplicationMessages\([^)]*\)\.catch\(\(\) => \[\]\)/);
  assert.match(read('../src/pages/candidate/MessagesPage.tsx'), /loadError && <Banner tone="error"/);
  // Sign-in does not send a returning candidate to Step 1 when the resume check fails.
  assert.match(read('../src/App.tsx'), /loadLatestResume\(\{ userId: user\.id \}\)\.then\(Boolean, \(\) => true\)/);
});

test('employers can report and block for real, not with a placeholder toast', () => {
  const dashboard = read('../src/pages/EmployerDashboard.tsx');
  assert.doesNotMatch(dashboard, /Report submitted\./);
  assert.doesNotMatch(dashboard, /Block action recorded\./);
  assert.doesNotMatch(dashboard, /loadApplicationMessages\([^)]*\)\.catch\(\(\) => \[\]\)/);
  assert.match(dashboard, /submitMessageModeration\(\{ applicationId: candidate\.id, \.\.\.input \}\)/);
  assert.match(dashboard, /action: 'report', reason, details/);
  assert.match(dashboard, /<ReportConversationModal/);
  assert.match(dashboard, /&& !selectedModeration\?\.blocked/);
  const page = read('../src/pages/employer/EmployerMessagesPage.tsx');
  assert.match(page, /moderation\?\.reported_by_me \? 'Reported' : 'Report'/);
  assert.match(page, /label: 'Unblock'/);
});

test('report reasons cover scams and harassment and match the backend list', () => {
  const api = read('../src/lib/api.ts');
  const block = api.slice(api.indexOf('export const MESSAGE_REPORT_REASONS'), api.indexOf('];', api.indexOf('export const MESSAGE_REPORT_REASONS')));
  const values = [...block.matchAll(/value: '([a-z]+)'/g)].map((match) => match[1]).sort();
  const backend = read('../../backend/app/main.py').match(/MESSAGE_REPORT_REASONS = \{([^}]*)\}/)[1];
  const backendValues = [...backend.matchAll(/"([a-z]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(values, backendValues);
  assert.ok(values.includes('scam') && values.includes('harassment'));
});

test('every screen with a match percentage says it is not a hiring probability', () => {
  assert.match(read('../src/lib/matchDisclaimer.ts'), /not your chance of being hired/);
  assert.match(read('../src/lib/matchDisclaimer.ts'), /not a hiring probability/);
  for (const path of [
    '../src/pages/candidate/MatchesPage.tsx',
    '../src/pages/candidate/JobDetailModal.tsx',
    '../src/pages/candidate/SkillGapsPage.tsx',
    '../src/pages/ExternalJobAnalysisPage.tsx',
    '../src/components/SnapshotStep.tsx',
    '../src/pages/employer/EmployerCandidatesPage.tsx',
  ]) {
    assert.match(read(path), /<MatchScoreNotice/, path);
  }
  assert.match(read('../src/lib/reportPdf.ts'), /MATCH_SCORE_DISCLAIMER_PLAIN/);
  assert.doesNotMatch(read('../src/pages/candidate/model.ts'), /You are already a strong candidate/);
});
