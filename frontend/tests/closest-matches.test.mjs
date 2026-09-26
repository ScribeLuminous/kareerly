import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { readCandidateSource } from './helpers/candidateSource.mjs';

const source = readFileSync(new URL('../src/lib/closestMatches.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const closest = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const snapshotSource = readFileSync(new URL('../src/components/SnapshotStep.tsx', import.meta.url), 'utf8');
const dashboardSource = readCandidateSource();

const item = (id, title, percent) => ({ job_id: id, job_title: title, match_percentage: percent, match_category: 'Closest Match', is_closest_match: true });

test('the report shows closest matches within the same per-type limit', () => {
  const list = [item('a', 'A', 40), item('b', 'B', 38), item('c', 'C', 35), item('d', 'D', 30)];
  const results = { fit_now_matches: [], aspiration_matches: [], closest_matches: list };
  assert.equal(closest.closestMatchesFor(results, { fit_now_matches: [], aspiration_matches: [], closest_matches: list }, 3).length, 3);
  assert.equal(closest.closestMatchesFor(results).length, 4);
  // Older saved reports have no closest list.
  assert.deepEqual(closest.closestMatchesFor({ fit_now_matches: [], aspiration_matches: [] }), []);
});

test('an empty Fit-Now list explains itself honestly', () => {
  const notice = 'No job meets every Fit-Now requirement yet.';
  assert.equal(closest.emptyFitNowText({ recommendation_notice: notice, catalog_status: { state: 'available', jobs_available: 3, message: '' } }, 2), notice);
  const empty = { state: 'empty', jobs_available: 0, message: 'There are no active job postings to compare with your resume right now.' };
  assert.equal(closest.emptyFitNowText({ catalog_status: empty }, 0), empty.message);
  const down = { state: 'unavailable', jobs_available: 0, message: 'The job catalogue could not be loaded.' };
  assert.equal(closest.emptyFitNowText({ catalog_status: down }, 0), down.message);
  assert.equal(closest.emptyFitNowText({}, 0), 'No fit-now matches returned yet.');
});

test('the summary never calls a closest match Fit-Now', () => {
  assert.equal(closest.fitNowSummaryDetail({ job_title: 'Support Specialist' }, 82.4, undefined), 'Best match: Support Specialist at 82%.');
  const detail = closest.fitNowSummaryDetail(undefined, null, item('cs', 'Customer Success Associate', 37.25));
  assert.equal(detail, 'Best match: Not available yet. Closest opportunity (not Fit-Now): Customer Success Associate at 37%.');
  assert.equal(closest.fitNowSummaryDetail(undefined, null, undefined), 'Best match: Not available yet');
});

test('Step 4 and its PDF list closest matches separately from Fit-Now', () => {
  assert.match(snapshotSource, /Closest opportunities \(not Fit-Now\)/);
  assert.match(snapshotSource, /heading: 'Closest Opportunities \(not Fit-Now\)'/);
  assert.match(snapshotSource, /describeMatch\(match, 'closest', skillNameLookup\)/);
  // The Fit-Now count still comes from the backend's Fit-Now count only.
  assert.match(snapshotSource, /resolveSnapshotCount\(matchResults\.debug_summary\?\.fit_now_count, fullFitNowMatches\)/);
});

test('the dashboard labels closest matches and never counts them as Fit-Now', () => {
  assert.match(dashboardSource, /job\.closestMatch \? 'Closest Match' : 'Aspiration'/);
  assert.match(dashboardSource, /mapRunMatch\(match, 'aspiration'\)\)\)\s*\.filter\(\(job\) => !fitNowIds\.has\(job\.id\)\);\s*const listedIds/);
  assert.match(dashboardSource, /job\.hasMatchScore && !job\.closestMatch/);
});
