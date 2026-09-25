import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function moduleUrl(source) { return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64'); }
const scoring = moduleUrl(fs.readFileSync(new URL('../src/lib/matchScoring.ts', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace("'./matchScoring'", JSON.stringify(scoring)).replace("import { supabase } from './supabase';", 'const supabase = { auth: { getSession: async () => ({data: {session: null}}) } };').replaceAll('import.meta.env', '({ VITE_API_BASE_URL: " http://127.0.0.1:8000/ " })').replace('BACKEND_WAKE_TIMEOUT_MS = 90_000', 'BACKEND_WAKE_TIMEOUT_MS = 0');
const api = await import(moduleUrl(source));
globalThis.window = globalThis;
const requests = [() => api.runJobMatches({ resume_text_for_matching: 'SQL developer', preferences: {} }), () => api.runMatchesFromResume({ resumeFile: new File(['resume'], 'resume.pdf'), preferences: {} })];
test('matching HTTP errors preserve server messages and normalize local URL', async () => {
 const original = globalThis.fetch;
 try {
  for (const status of [400, 422, 500]) {
   globalThis.fetch = async url => { assert.match(url, /^http:\/\/127\.0\.0\.1:8000\/api\/matches\//); return new Response(JSON.stringify({ detail: `Server error ${status}` }), { status }); };
   for (const request of requests) await assert.rejects(request(), new RegExp(`Server error ${status}`));
  }
 } finally { globalThis.fetch = original; }
});
test('matching distinguishes network failure and timeout', async () => {
 const original = globalThis.fetch;
 const originalConsoleError = console.error;
 try {
  console.error = () => {};
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  for (const request of requests) await assert.rejects(request(), /Cannot reach/);
  globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  for (const request of requests) await assert.rejects(request(), /timed out/);
 } finally { globalThis.fetch = original; console.error = originalConsoleError; }
});

test('hosted matching connection errors do not mislabel gateway failures as CORS', async () => {
 const hostedSource = source.replace('http://127.0.0.1:8000/ ', 'https://backend.example.org/ ');
 const hostedApi = await import(moduleUrl(hostedSource));
 const original = globalThis.fetch;
 const originalLocation = globalThis.location;
 const originalConsoleError = console.error;
 const hostedRequests = [
  () => hostedApi.runJobMatches({ resume_text_for_matching: 'SQL developer', preferences: {} }),
  () => hostedApi.runMatchesFromResume({ resumeFile: new File(['resume'], 'resume.pdf'), preferences: {} }),
 ];
 try {
  globalThis.location = { origin: 'https://frontend.example.org' };
  console.error = () => {};

  // An opaque health answer can be a Cloudflare challenge, not a CORS diagnosis.
  globalThis.fetch = async (url, options) => {
   if (String(url).endsWith('/api/health') && options.mode === 'no-cors') {
    // A real no-cors reply is opaque; only "it answered" matters to the probe.
    return new Response(null, { status: 200 });
   }
   throw new TypeError('Failed to fetch');
  };
  for (const request of hostedRequests) {
   await assert.rejects(request(), error => {
    assert.match(error.message, /https:\/\/backend.example.org/);
    assert.match(error.message, /hosting protection or a network interruption/);
    assert.doesNotMatch(error.message, /FRONTEND_URLS/);
    assert.doesNotMatch(error.message, /npm run dev/);
    return true;
   });
  }

  // Nothing answers, so the service itself is down rather than rejecting the origin.
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  for (const request of hostedRequests) {
   await assert.rejects(request(), error => {
    assert.match(error.message, /https:\/\/backend.example.org/);
    assert.match(error.message, /not responding/);
    assert.doesNotMatch(error.message, /FRONTEND_URLS/);
    assert.doesNotMatch(error.message, /npm run dev/);
    return true;
   });
  }
 } finally {
  globalThis.fetch = original;
  globalThis.location = originalLocation;
  console.error = originalConsoleError;
 }
});

test('text matching sends a multipart simple request without custom headers', async () => {
 const original = globalThis.fetch;
 try {
  globalThis.fetch = async (url, options) => {
   assert.match(String(url), /\/api\/matches\/run-form$/);
   assert.equal(options.method, 'POST');
   assert.equal(options.headers, undefined);
   assert.ok(options.body instanceof FormData);
   const payload = JSON.parse(options.body.get('payload'));
   assert.equal(payload.resume_text_for_matching, 'SQL developer');
   assert.equal(payload.confirmed_skills[0].skill_name, 'SQL');
   return new Response(JSON.stringify({ fit_now_matches: [], aspiration_matches: [] }), { status: 200 });
  };
  await api.runJobMatches({
   resume_text_for_matching: 'SQL developer',
   confirmed_skills: [{ skill_id: 'SK004', skill_name: 'SQL' }],
   preferences: {},
  });
 } finally { globalThis.fetch = original; }
});

test('hosted requests wait for a sleeping backend and retry once', async () => {
 const wakingSource = source.replace('http://127.0.0.1:8000/ ', 'https://backend.example.org/ ').replace('BACKEND_WAKE_TIMEOUT_MS = 0', 'BACKEND_WAKE_TIMEOUT_MS = 60_000').replace('BACKEND_WAKE_POLL_MS = 5_000', 'BACKEND_WAKE_POLL_MS = 1');
 const wakingApi = await import(moduleUrl(wakingSource));
 const original = globalThis.fetch;
 let awake = false;
 let healthChecks = 0;
 try {
  globalThis.fetch = async (url) => {
   if (String(url).endsWith('/api/health')) {
    healthChecks += 1;
    if (healthChecks < 3) throw new TypeError('Failed to fetch');
    awake = true;
    return new Response('{"status":"ok"}', { status: 200 });
   }
   if (!awake) throw new TypeError('Failed to fetch');
   return new Response(JSON.stringify({ status: 'success', candidate_profile: { skills: [] }, normalized_for_matching: {} }), { status: 200 });
  };
  const result = await wakingApi.analyzeResume(new File(['resume'], 'resume.pdf'));
  assert.equal(result.status, 'success');
  assert.equal(healthChecks, 3);
 } finally {
  globalThis.fetch = original;
 }
});

test('both matching routes keep the total skill gap count beyond the listed gaps', async () => {
 const original = globalThis.fetch;
 const gaps = Array.from({ length: 8 }, (_, index) => ({ skill_name: `Skill ${index}`, frequency: 1, missing_percentage: 10 }));
 try {
  globalThis.fetch = async () => new Response(JSON.stringify({ fit_now_matches: [], aspiration_matches: [], skill_gaps: gaps, total_skill_gap_count: 11 }), { status: 200 });
  for (const request of requests) {
   const result = await request();
   assert.equal(result.total_skill_gap_count, 11);
   assert.equal(result.skill_gaps.length, 8);
  }
 } finally { globalThis.fetch = original; }
});

test('both matching routes keep closest matches, the catalogue status and the notice', async () => {
 const original = globalThis.fetch;
 const closest = { job_id: 'cs', job_title: 'Customer Success Associate', match_percentage: 37.25, match_category: 'Closest Match',
  match_type: 'Closest Match', is_closest_match: true, base_match_category: 'Low Match', closest_match_strength: 'related' };
 const body = {
  fit_now_matches: [], aspiration_matches: [], closest_matches: [closest], all_closest_matches: [closest],
  catalog_status: { state: 'available', jobs_available: 4, message: '' },
  recommendation_notice: 'No job meets every Fit-Now requirement yet.',
  limited_report: { fit_now_matches: [], aspiration_matches: [], closest_matches: [closest], skill_gaps: [], learning_recommendations: [] },
  skill_gaps: [],
 };
 try {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
  for (const request of requests) {
   const result = await request();
   assert.deepEqual(result.fit_now_matches, []);
   assert.equal(result.closest_matches[0].job_id, 'cs');
   assert.equal(result.closest_matches[0].match_category, 'Closest Match');
   assert.equal(result.all_closest_matches.length, 1);
   assert.equal(result.limited_report.closest_matches[0].is_closest_match, true);
   assert.equal(result.catalog_status.state, 'available');
   assert.equal(result.recommendation_notice, 'No job meets every Fit-Now requirement yet.');
  }
 } finally { globalThis.fetch = original; }
});
