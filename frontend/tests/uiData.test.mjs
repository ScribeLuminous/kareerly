import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/uiData.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { savedMatchScore, scoreLabel, applicationNotices } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('missing or invalid saved scores do not become zero-percent matches', () => {
  for (const value of [null, undefined, '', ' ', false, true, {}, NaN, Infinity, 'unknown', -1, 101]) {
    assert.equal(savedMatchScore(value), null);
    assert.equal(scoreLabel(savedMatchScore(value)), 'Not available');
  }
  assert.equal(scoreLabel(savedMatchScore(0)), '0%');
  assert.equal(scoreLabel(savedMatchScore('0')), '0%');
  assert.equal(scoreLabel(savedMatchScore(82.4)), '82%');
});

const app = { id: 'app-1', company: 'Employer', jobTitle: 'Role', status: 'Interviewing' };

test('interview status alone does not invent a message request', () => {
  for (const messageRequestState of [undefined, 'none', 'accepted', 'declined', 'ignored']) {
    assert.deepEqual(applicationNotices([{ ...app, messageRequestState }]), []);
  }
  assert.equal(applicationNotices([{ ...app, messageRequestState: 'pending' }])[0].kind, 'message');
  assert.deepEqual(applicationNotices([{ ...app, status: 'Rejected', messageRequestState: 'pending' }]), []);
});

test('application notifications use available update times and separate application IDs', () => {
  const notices = applicationNotices([
    { ...app, messageRequestState: 'pending' },
    { ...app, id: 'app-2', status: 'Hired', messageRequestState: 'pending', updatedAt: '2026-09-15T10:00:00Z' },
    { ...app, id: 'app-3', status: 'Shortlisted', updatedAt: 'invalid' },
  ]);
  assert.equal(notices.length, 3);
  assert.equal(new Set(notices.map((notice) => notice.id)).size, 3);
  assert.equal(notices[0].time, 'Update time unavailable');
  assert.equal(notices[1].time, new Date('2026-09-15T10:00:00Z').toLocaleString());
  assert.equal(notices[2].time, 'Update time unavailable');
  assert.deepEqual(applicationNotices([]), []);
});
