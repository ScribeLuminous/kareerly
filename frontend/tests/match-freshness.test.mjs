import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { readCandidateFile, readCandidateSource } from './helpers/candidateSource.mjs';

const source = readFileSync(new URL('../src/lib/matchFreshness.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { isMatchRunStale } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const dashboardSource = readCandidateSource();
const userDataSource = readFileSync(new URL('../src/lib/userData.ts', import.meta.url), 'utf8');

const ranAt = '2026-10-28T08:00:00Z';

test('a job posted after the saved run makes it stale', () => {
  const jobs = [{ created_at: '2026-10-01T00:00:00Z' }, { created_at: '2026-10-28T09:30:00+08:00' }, { created_at: '2026-10-28T09:00:00Z' }];
  assert.equal(isMatchRunStale(ranAt, jobs), true);
});

test('a job edited after the saved run makes it stale', () => {
  assert.equal(isMatchRunStale(ranAt, [{ created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-28T08:00:01Z' }]), true);
});

test('jobs older than the run, or with unknown times, keep it', () => {
  assert.equal(isMatchRunStale(ranAt, [{ created_at: '2026-10-28T07:59:59Z', updated_at: '' }, {}]), false);
  assert.equal(isMatchRunStale(ranAt, []), false);
  // A run with no saved time is never refreshed on its own.
  assert.equal(isMatchRunStale(null, [{ created_at: '2026-10-29T00:00:00Z' }]), false);
  assert.equal(isMatchRunStale('not a date', [{ created_at: '2026-10-29T00:00:00Z' }]), false);
});

test('the dashboard refreshes a restored run once the jobs and claims are loaded', () => {
  assert.match(userDataSource, /select\('results_json,preferences_json,created_at'\)/);
  assert.match(dashboardSource, /isMatchRunStale\(restoredRunAt, availableJobs\)/);
  assert.match(dashboardSource, /progressLoad\.status !== 'ready'/);
  assert.match(dashboardSource, /checkedRunAt\.current = restoredRunAt/);
});

test('preference mismatches are shown on the job, never used to filter it', () => {
  const modal = readCandidateFile('JobDetailModal.tsx');
  assert.match(modal, /Preferences this job does not match/);
  assert.doesNotMatch(modal, /Not what you chose/);
  assert.match(modal, /faXmark/);
  assert.match(dashboardSource, /preferenceMismatches: mapPreferenceMismatches\(match\.preference_mismatches\)/);
  assert.doesNotMatch(dashboardSource, /preferenceMismatches[^\n]*\.filter\(\(job/);
});
