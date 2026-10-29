import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText).toString('base64');
}

const version = await import(moduleUrl(fs.readFileSync(new URL('../src/lib/backendVersion.ts', import.meta.url), 'utf8')));

test('the website expects the version the backend reports', () => {
  const backend = fs.readFileSync(new URL('../../backend/app/main.py', import.meta.url), 'utf8');
  assert.equal(version.EXPECTED_BACKEND_VERSION, backend.match(/^BACKEND_VERSION = "([^"]+)"/m)?.[1]);
});

test('a backend reporting the expected version is current', () => {
  assert.deepEqual(version.assessBackendVersion({ status: 'ok', backend_version: version.EXPECTED_BACKEND_VERSION }), { status: 'current' });
});

test('a backend without a version or with another one is outdated', () => {
  // Backends from before the version was reported (the endpoint answers without it, or 404s).
  assert.deepEqual(version.assessBackendVersion({ status: 'ok', resume_readers: {} }),
    { status: 'outdated', reported: null, expected: version.EXPECTED_BACKEND_VERSION });
  assert.deepEqual(version.assessBackendVersion({}), { status: 'outdated', reported: null, expected: version.EXPECTED_BACKEND_VERSION });
  const older = version.assessBackendVersion({ backend_version: '2026.09.20' });
  assert.equal(older.status, 'outdated');
  assert.match(version.outdatedBackendMessage(older).detail, /2026\.09\.20.*2026\.10\.29-full-job-list/);
});

test('an unreadable backend is unknown, never reported as outdated', () => {
  assert.deepEqual(version.assessBackendVersion(null), { status: 'unknown' });
  assert.deepEqual(version.assessBackendVersion('nope'), { status: 'unknown' });
});
