import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { readCandidateSource } from './helpers/candidateSource.mjs';

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64');
}

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const feedback = await import(moduleUrl(read('../src/lib/matchFeedback.ts')));
globalThis.window = globalThis;

function loadApi(session = { access_token: 'user-token' }) {
  const scoring = moduleUrl(read('../src/lib/matchScoring.ts'));
  const source = read('../src/lib/api.ts')
    .replace("'./matchScoring'", JSON.stringify(scoring))
    .replace("import { supabase } from './supabase';", `const supabase = { auth: { getSession: async () => ({ data: { session: ${JSON.stringify(session)} } }), refreshSession: async () => ({ data: { session: { access_token: 'fresh-token' } } }) } };`)
    .replaceAll('import.meta.env', '({ VITE_API_BASE_URL: "http://127.0.0.1:8000" })');
  return import(moduleUrl(source));
}

test('selecting a vote sets it, selecting it again removes it, the other vote replaces it', () => {
  assert.equal(feedback.nextMatchVote(null, 'good'), 'good');
  assert.equal(feedback.nextMatchVote('good', 'good'), null);
  assert.equal(feedback.nextMatchVote('good', 'bad'), 'bad');
  assert.equal(feedback.nextMatchVote('bad', 'bad'), null);
});

test('saved ratings are keyed by job source and id and junk rows are ignored', () => {
  const map = feedback.feedbackMapFromRows([
    { job_id: 'JOB-1', job_source: 'internal', vote: 'good' },
    { job_id: 'JOB-1', job_source: 'employer', vote: 'bad' },
    { job_id: '', job_source: 'internal', vote: 'good' },
    { job_id: 'JOB-2', job_source: 'internal', vote: 'maybe' },
  ]);
  assert.deepEqual(map, { 'internal:JOB-1': 'good', 'employer:JOB-1': 'bad' });
});

test('status text describes saving, the saved choice and how to remove it', () => {
  assert.match(feedback.feedbackStatusText('good', { state: 'saving', vote: 'good' }), /Saving/);
  assert.match(feedback.feedbackStatusText(null, { state: 'saving', vote: null }), /Removing/);
  assert.match(feedback.feedbackStatusText('bad', { state: 'idle' }), /bad match.*again to remove/i);
  assert.equal(feedback.feedbackStatusText(null, { state: 'idle' }), '');
  assert.match(feedback.feedbackErrorMessage(new TypeError('Failed to fetch')), /connection/);
  assert.equal(feedback.feedbackErrorMessage(new Error('Only jobs from your saved recommendations can be rated.')), 'Only jobs from your saved recommendations can be rated.');
});

test('ratings are sent to the backend with the session token', async () => {
  const api = await loadApi();
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body });
      if ((options.method || 'GET') === 'GET') return new Response(JSON.stringify({ feedback: [{ job_id: 'J', job_source: 'internal', vote: 'good' }] }));
      if (options.method === 'PUT') return new Response(JSON.stringify({ feedback: { job_id: 'J', job_source: 'employer', vote: 'bad' } }));
      return new Response(JSON.stringify({ deleted: true }));
    };
    assert.deepEqual(await api.loadMatchFeedback(), [{ job_id: 'J', job_source: 'internal', vote: 'good' }]);
    assert.equal((await api.saveMatchFeedback({ jobId: 'J', jobSource: 'employer', vote: 'bad' })).vote, 'bad');
    await api.removeMatchFeedback({ jobId: 'J 1', jobSource: 'internal' });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/api/candidate/match-feedback');
  assert.equal(calls[1].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].body), { job_id: 'J', job_source: 'employer', vote: 'bad' });
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[2].url, 'http://127.0.0.1:8000/api/candidate/match-feedback?job_id=J+1&job_source=internal');
  assert.ok(calls.every((call) => call.headers.Authorization === 'Bearer user-token'));
});

test('rating errors keep the server message and signed-out users cannot rate', async () => {
  const api = await loadApi();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Too many ratings in a short time. Please try again later.' }), { status: 429 });
    await assert.rejects(api.saveMatchFeedback({ jobId: 'J', jobSource: 'internal', vote: 'good' }), /Too many ratings/);
    globalThis.fetch = async () => new Response('', { status: 500 });
    await assert.rejects(api.removeMatchFeedback({ jobId: 'J', jobSource: 'internal' }), /Unable to remove your rating/);
  } finally {
    globalThis.fetch = original;
  }
  const signedOut = await loadApi(null);
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('{}'); };
  try {
    await assert.rejects(signedOut.saveMatchFeedback({ jobId: 'J', jobSource: 'internal', vote: 'good' }), /log in/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetched, false);
});

test('rating controls are accessible toggle buttons with a live status', () => {
  const component = read('../src/components/MatchFeedbackControls.tsx');
  assert.match(component, /role="group"/);
  assert.match(component, /aria-pressed=\{selected\}/);
  assert.match(component, /role="status" aria-live="polite"/);
  assert.match(component, /role="alert"/);
  assert.match(component, /disabled=\{saving\}/);
  assert.match(component, /label: 'Good match'/);
  assert.match(component, /label: 'Bad match'/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /Try again/);
});

test('job details render the rating controls and do not present scores as hiring odds', () => {
  const dashboard = readCandidateSource();
  // Ratings live in the job detail (shown beside the list on desktop, as a dialog on phones).
  const detailStart = dashboard.indexOf('export function JobDetailBody');
  const detail = dashboard.slice(detailStart, dashboard.indexOf('\nexport function ', detailStart + 10));
  assert.match(detail, /<MatchFeedbackControls/);
  assert.match(detail, /job\.hasMatchScore && !job\.closestMatch/);
  assert.match(dashboard, /matchFeedbackKey\(job\.id, job\.jobSource\)/);
  // The score line shows the shared disclaimer, in a tooltip and as visible text.
  assert.match(dashboard, /MATCH_SCORE_DISCLAIMER/);
  assert.match(dashboard, /<MatchScoreNotice/);
  assert.match(read('../src/lib/matchDisclaimer.ts'), /not your chance of being hired/);
  // A failed save restores the previous choice instead of showing a vote that was not saved.
  assert.match(dashboard, /withMatchVote\(current, key, previous\)/);
  const css = read('../src/pages/candidate-dashboard-v5.css');
  assert.match(css, /\.cand-feedback-btn\s*\{[^}]*min-height:\s*36px/s);
});

test('admin learning calls use the admin token and surface server errors', async () => {
  const api = await loadApi();
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', auth: options.headers.Authorization, body: options.body });
      if (String(url).includes('/review')) return new Response(JSON.stringify({ detail: 'That name is already in the skill taxonomy.' }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, candidates: [] }));
    };
    await api.fetchLearningStatus('admin-token');
    await api.runLearningJobs('admin-token', { job: 'all', dry_run: true });
    await api.rollbackRankingModel('admin-token');
    await api.fetchSkillCandidates('admin-token');
    await assert.rejects(api.reviewSkillCandidate('admin-token', 'id/1', { action: 'approve_new' }), /already in the skill taxonomy/);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('http://127.0.0.1:8000', '')}`), [
    'GET /api/admin/learning/status',
    'POST /api/admin/learning/run',
    'POST /api/admin/learning/rollback',
    'GET /api/admin/skill-candidates?status=pending',
    'POST /api/admin/skill-candidates/id%2F1/review',
  ]);
  assert.ok(calls.every((call) => call.auth === 'Bearer admin-token'));
  assert.deepEqual(JSON.parse(calls[2].body), { target_version: null });
});

test('admin panel confirms rollbacks and states that proposals need approval', () => {
  const panel = read('../src/components/AdminLearningPanel.tsx');
  assert.match(panel, /window\.confirm\(`Switch job ranking/);
  assert.match(panel, /Nothing is added to the skill catalog until it is approved/);
  assert.match(panel, /eligibility and match percentages never change/);
  assert.match(read('../src/pages/AdminDashboard.tsx'), /<AdminLearningPanel getToken=\{getAdminToken\} \/>/);
});

test('each match list keeps the backend order so feedback ranking is visible', () => {
  const dashboard = readCandidateSource();
  const start = dashboard.indexOf('function orderByBackendRank');
  const helper = dashboard.slice(start, dashboard.indexOf('\n}\n', start) + 2).replace('jobs: DashboardJob[]): DashboardJob[]', 'jobs)');
  const orderByBackendRank = new Function(`${ts.transpile(helper)}; return orderByBackendRank;`)();
  const ranked = [{ id: 'a', matchScore: 90, rankPosition: 2 }, { id: 'b', matchScore: 80, rankPosition: 1 }];
  assert.deepEqual(orderByBackendRank(ranked).map((job) => job.id), ['b', 'a']);
  // Results saved before rank positions existed keep their existing order.
  const legacy = [{ id: 'a', matchScore: 90 }, { id: 'b', matchScore: 80, rankPosition: 1 }];
  assert.deepEqual(orderByBackendRank(legacy).map((job) => job.id), ['a', 'b']);
  assert.match(dashboard, /rankPosition: typeof dynamic\.rank_position === 'number'/);
  // The Fit-Now and Aspiration lists; the Learning tab groups by skill and lists no matches.
  assert.equal((dashboard.match(/orderByBackendRank\(jobs\.filter\(\(job\) => job\.matchCategory === '(fit-now|aspiration)'\)\)/g) || []).length, 2);
});
