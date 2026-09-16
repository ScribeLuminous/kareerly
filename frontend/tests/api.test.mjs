import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function moduleUrl(source) { return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64'); }
const scoring = moduleUrl(fs.readFileSync(new URL('../src/lib/matchScoring.ts', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace("'./matchScoring'", JSON.stringify(scoring)).replace("import { supabase } from './supabase';", 'const supabase = { auth: { getSession: async () => ({data: {session: null}}) } };').replaceAll('import.meta.env', '({ VITE_API_BASE_URL: " http://127.0.0.1:8000/ " })');
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

test('hosted matching connection errors identify backend and CORS origin', async () => {
 const hostedSource = source.replace('http://127.0.0.1:8000/ ', 'https://backend.example.org/ ');
 const hostedApi = await import(moduleUrl(hostedSource));
 const original = globalThis.fetch;
 const originalLocation = globalThis.location;
 const originalConsoleError = console.error;
 try {
  globalThis.location = { origin: 'https://frontend.example.org' };
  console.error = () => {};
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  for (const request of [
   () => hostedApi.runJobMatches({ resume_text_for_matching: 'SQL developer', preferences: {} }),
   () => hostedApi.runMatchesFromResume({ resumeFile: new File(['resume'], 'resume.pdf'), preferences: {} }),
  ]) {
   await assert.rejects(request(), error => {
    assert.match(error.message, /https:\/\/backend.example.org/);
    assert.match(error.message, /FRONTEND_URLS/);
    assert.match(error.message, /https:\/\/frontend.example.org/);
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
