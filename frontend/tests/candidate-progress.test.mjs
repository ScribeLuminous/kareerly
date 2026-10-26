import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { readCandidateSource } from './helpers/candidateSource.mjs';

// Claimed skills, skill progress and course completions are saved per user in
// Supabase (src/lib/candidateProgress.ts), so they match on every device.

const source = fs.readFileSync(new URL('../src/lib/candidateProgress.ts', import.meta.url), 'utf8')
  .replace("import { supabase } from './supabase';", 'const supabase = { from: (table) => globalThis.candidateProgressTestSupabase.from(table) };');
const progress = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));

const helpers = {
  keyOf: ({ skillId, skill }) => (skillId || skill.toLowerCase().trim()).toUpperCase(),
  categoryOf: () => 'Other',
};

// An in-memory stand-in for the three tables, enough for select/upsert/delete
// as the module calls them. `fail` makes a table's calls return an error.
function fakeDatabase() {
  const tables = { candidate_claimed_skills: [], candidate_skill_progress: [], candidate_course_completions: [] };
  const fail = {};
  const calls = [];
  const client = {
    from(table) {
      const filters = [];
      const matches = (row) => filters.every(([column, test]) => test(row[column]));
      const result = (data) => (fail[table] ? { data: null, error: { message: fail[table] } } : { data, error: null });
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, (v) => v === value]); return query; },
        in(column, values) { filters.push([column, (v) => values.includes(v)]); return query; },
        delete() { query.op = 'delete'; return query; },
        upsert(rows, options) {
          calls.push({ table, op: 'upsert', rows, options });
          if (fail[table]) return Promise.resolve(result(null));
          const conflict = options.onConflict.split(',');
          rows.forEach((row) => {
            const existing = tables[table].find((item) => conflict.every((column) => item[column] === row[column]));
            if (existing) Object.assign(existing, row, { updated_at: new Date().toISOString() });
            else tables[table].push({ ...row, updated_at: new Date().toISOString() });
          });
          return Promise.resolve(result(null));
        },
        then(resolve, reject) {
          if (query.op === 'delete') {
            calls.push({ table, op: 'delete' });
            if (!fail[table]) tables[table] = tables[table].filter((row) => !matches(row));
            return Promise.resolve(result(null)).then(resolve, reject);
          }
          return Promise.resolve(result(tables[table].filter(matches).map((row) => ({ ...row })))).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { tables, fail, calls, client };
}

// One browser: holds what it last loaded or saved, and saves its changes like the dashboard does.
async function browser(db, userId) {
  globalThis.candidateProgressTestSupabase = db.client;
  let saved = await progress.loadCandidateProgress(userId, helpers);
  return {
    state: structuredClone(saved),
    async save() {
      globalThis.candidateProgressTestSupabase = db.client;
      for (const part of progress.PROGRESS_PARTS) {
        const change = progress.diffProgressPart(part, saved, this.state);
        if (!progress.hasProgressChanges(change)) continue;
        await progress.saveProgressChanges(userId, part, change);
        saved = progress.applyProgressChanges(saved, part, change);
      }
    },
  };
}

test('claims, skill progress and course completions saved on one browser load on another', async () => {
  const db = fakeDatabase();
  const laptop = await browser(db, 'user-a');
  laptop.state.claimedSkills.SK300 = { skillId: 'SK300', skillName: 'Python', claimedAt: '2026-10-01T00:00:00.000Z' };
  laptop.state.skillProgress.SK200 = {
    skillId: 'SK200', skillName: 'SQL', category: 'Programming & Scripting', categoryName: 'Programming & Scripting',
    status: 'completed', progressPercent: 70, selectedResourceId: 'course-1',
  };
  laptop.state.courseCompletions['course-1'] = { status: 'completed', markedAt: '2026-10-02T00:00:00.000Z' };
  await laptop.save();

  const phone = await browser(db, 'user-a');
  const asSaved = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(asSaved(phone.state), asSaved(laptop.state));

  // Changes on the phone (unclaim, proof uploaded) show on the laptop after it reloads.
  delete phone.state.claimedSkills.SK300;
  phone.state.courseCompletions['course-1'] = { status: 'evidenced', markedAt: '2026-10-02T00:00:00.000Z', evidenceId: 'evidence-1' };
  await phone.save();
  const laptopAgain = await browser(db, 'user-a');
  assert.deepEqual(laptopAgain.state.claimedSkills, {});
  assert.equal(laptopAgain.state.courseCompletions['course-1'].status, 'evidenced');
  assert.equal(laptopAgain.state.courseCompletions['course-1'].evidenceId, 'evidence-1');

  // Another account sees none of it.
  const other = await browser(db, 'user-b');
  assert.deepEqual(other.state, { claimedSkills: {}, skillProgress: {}, courseCompletions: {} });
  delete globalThis.candidateProgressTestSupabase;
});

test('rows are written with the owner and upserted on the per-user key', async () => {
  const db = fakeDatabase();
  globalThis.candidateProgressTestSupabase = db.client;
  await progress.saveProgressChanges('user-a', 'skillProgress', {
    upserts: { SK200: { skillId: 'SK200', skillName: 'SQL', category: 'Other', status: 'in_progress', progressPercent: 35 } },
    deletes: [],
  });
  await progress.saveProgressChanges('user-a', 'claimedSkills', {
    upserts: { SK300: { skillId: 'SK300', skillName: 'Python', claimedAt: '2026-10-01T00:00:00.000Z' } },
    deletes: [],
  });
  const [skillCall, claimCall] = db.calls;
  assert.equal(skillCall.options.onConflict, 'candidate_id,skill_key');
  assert.equal(skillCall.rows[0].candidate_id, 'user-a');
  assert.equal(skillCall.rows[0].skill_key, 'SK200');
  assert.equal(skillCall.rows[0].status, 'in_progress');
  assert.equal(claimCall.options.onConflict, 'user_id,skill_key');
  assert.equal(claimCall.rows[0].user_id, 'user-a');
  delete globalThis.candidateProgressTestSupabase;
});

test('a failed load or save is an error, never an empty or silent result', async () => {
  const db = fakeDatabase();
  globalThis.candidateProgressTestSupabase = db.client;
  db.fail.candidate_course_completions = 'permission denied';
  await assert.rejects(progress.loadCandidateProgress('user-a', helpers), /Unable to load your saved course progress: permission denied/);

  db.fail.candidate_claimed_skills = 'network down';
  await assert.rejects(
    progress.saveProgressChanges('user-a', 'claimedSkills', { upserts: { SK1: { skillName: 'Excel', claimedAt: 'x' } }, deletes: [] }),
    /Unable to save your list of skills you already have: network down/,
  );
  await assert.rejects(
    progress.saveProgressChanges('user-a', 'claimedSkills', { upserts: {}, deletes: ['SK1'] }),
    /network down/,
  );
  delete globalThis.candidateProgressTestSupabase;
});

test('only changed and removed records are saved', () => {
  const record = { skillId: 'SK1', skillName: 'Excel', category: 'Other', status: 'missing', progressPercent: 0 };
  const saved = { claimedSkills: {}, skillProgress: { SK1: record, SK2: { ...record, skillId: 'SK2' } }, courseCompletions: {} };
  // Same values in a different property order are unchanged.
  const reordered = { progressPercent: 0, status: 'missing', category: 'Other', skillName: 'Excel', skillId: 'SK1' };
  const current = { ...saved, skillProgress: { SK1: reordered, SK3: { ...record, skillId: 'SK3', status: 'in_progress' } } };
  const change = progress.diffProgressPart('skillProgress', saved, current);
  assert.deepEqual(Object.keys(change.upserts), ['SK3']);
  assert.deepEqual(change.deletes, ['SK2']);
  assert.equal(progress.hasProgressChanges(progress.diffProgressPart('claimedSkills', saved, current)), false);
});

test('backend rows without a key are keyed like the dashboard, and the dashboard row wins', () => {
  const rows = [
    { skill_key: null, skill_id: 'SK100', skill_name: 'Excel', category_name: null, status: 'missing', progress_percent: 0, updated_at: '2026-10-05' },
    { skill_key: 'SK100', skill_id: 'SK100', skill_name: 'Excel', category_name: 'Core Office Tools', status: 'completed', progress_percent: 70, updated_at: '2026-10-01' },
    { skill_key: null, skill_id: null, skill_name: 'Report Writing', category_name: 'Not a category', status: 'bogus', progress_percent: null },
  ];
  const records = progress.skillProgressFromRows(rows, helpers);
  assert.equal(records.SK100.status, 'completed');
  assert.equal(records.SK100.category, 'Core Office Tools');
  assert.equal(records['REPORT WRITING'].status, 'missing');
  assert.equal(records['REPORT WRITING'].category, 'Other');
});

test('browser data from before is imported once: the account wins, then this browser, then memory', () => {
  const store = new Map([
    ['kareerly.claimedSkills.user-a', JSON.stringify({ SK1: { skillName: 'Excel' }, BAD: { nope: true } })],
    ['kareerly.skillProgress.user-a', JSON.stringify({ SK2: { skillName: 'SQL', status: 'completed', progressPercent: 70 }, SK9: { skillName: 'X', status: 'weird' } })],
    ['kareerly.courseCompletions.user-a', '{not json'],
  ]);
  const storage = { getItem: (key) => store.get(key) ?? null, removeItem: (key) => store.delete(key) };
  const legacy = progress.readLegacyProgress(storage, 'user-a');
  assert.deepEqual(Object.keys(legacy.claimedSkills), ['SK1']);
  assert.ok(legacy.claimedSkills.SK1.claimedAt, 'old claims get a date');
  assert.deepEqual(Object.keys(legacy.skillProgress), ['SK2']);
  assert.deepEqual(legacy.courseCompletions, {});
  assert.equal(progress.hasLegacyProgress(legacy), true);

  const generated = { status: 'missing', skillName: 'SQL' };
  const merged = progress.mergeLoadedProgress(
    { SK2: generated, SK5: generated },
    legacy.skillProgress,
    { SK5: { skillName: 'Python', status: 'in_progress' } },
  );
  assert.equal(merged.SK2.status, 'completed');
  assert.equal(merged.SK5.status, 'in_progress');

  progress.clearLegacyProgress(storage, 'user-a');
  assert.equal(store.size, 0);
  assert.doesNotThrow(() => progress.clearLegacyProgress(null, 'user-a'));
  assert.doesNotThrow(() => progress.readLegacyProgress({ getItem: () => { throw new Error('blocked'); } }, 'user-a'));
});

test('the dashboard keeps this data in the account, not only in the browser', () => {
  const dashboard = readCandidateSource();
  // localStorage is only read for the one-time import, never written for these.
  for (const key of ['claimedSkills', 'skillProgress', 'courseCompletions']) {
    assert.doesNotMatch(dashboard, new RegExp(`localStorage\\.setItem\\([^)]*${key}`));
  }
  assert.match(dashboard, /loadCandidateProgress\(userId, PROGRESS_HELPERS\)/);
  assert.match(dashboard, /saveProgressChanges\(userId, part, change\)/);
  // Nothing is saved before the account's copy has loaded.
  assert.match(dashboard, /if \(progressLoad\.status !== 'ready' \|\| !userId \|\| progressSavingRef\.current\) return;/);
  // Failures are shown, with a way to try again.
  assert.match(dashboard, /progressSyncError && \(\s*<Banner\s+tone="error"/);
  assert.match(dashboard, /if \(failure\) showToast\(/);
  // Claimed skills are always matched on and saved as confirmed skills.
  assert.match(dashboard, /skills = withClaimedSkillNames\(skills, claimed\);/);
  assert.match(dashboard, /source: 'confirmed_skill',\s*\}\)\)\);/);
});
