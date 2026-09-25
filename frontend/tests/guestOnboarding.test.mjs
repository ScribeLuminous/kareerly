import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText).toString('base64');
}

const guest = await import(moduleUrl(fs.readFileSync(new URL('../src/lib/guestOnboarding.ts', import.meta.url), 'utf8')));

function memoryStorage({ limit = Infinity } = {}) {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      if (value.length > limit) throw new Error('QuotaExceededError');
      items.set(key, value);
    },
    removeItem: (key) => items.delete(key),
  };
}

const report = {
  analysis: { candidate_profile: { skills: [{ skill_id: 'SK1', skill_name: 'Customer Service' }] }, normalized_for_matching: { resume_text_for_matching: 'resume' } },
  selectedSkills: [{ skill_id: 'SK1', skill_name: 'Customer Service' }],
  surveyAnswers: { industry: 'communications-creative-media', role: 'entry', setup: 'flexible', salary: 'unsure', skill: '' },
  matchResults: { fit_now_matches: [], aspiration_matches: [{ job_id: 'J1' }] },
};

test('a guest report and its resume file survive until the guest signs up', async () => {
  const storage = memoryStorage();
  const file = new File([new Uint8Array([37, 80, 68, 70, 0, 255])], 'resume.pdf', { type: 'application/pdf' });
  assert.equal(await guest.stashGuestOnboarding({ ...report, file }, storage, 1000), true);

  const restored = guest.readGuestOnboarding(storage, 2000);
  assert.deepEqual(restored.analysis, report.analysis);
  assert.deepEqual(restored.surveyAnswers, report.surveyAnswers);
  assert.deepEqual(restored.matchResults, report.matchResults);
  assert.equal(restored.file.name, 'resume.pdf');
  assert.equal(restored.file.type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await restored.file.arrayBuffer())], [37, 80, 68, 70, 0, 255]);

  guest.clearGuestOnboarding(storage);
  assert.equal(guest.readGuestOnboarding(storage, 2000), null);
});

test('a resume too large for storage still keeps the analysis and report', async () => {
  const storage = memoryStorage({ limit: 2000 });
  const file = new File([new Uint8Array(5000)], 'big.pdf', { type: 'application/pdf' });
  assert.equal(await guest.stashGuestOnboarding({ ...report, file }, storage, 1000), true);
  const restored = guest.readGuestOnboarding(storage, 2000);
  assert.equal(restored.file, null);
  assert.deepEqual(restored.matchResults, report.matchResults);
});

test('an old guest report is dropped rather than saved to whoever signs in later', async () => {
  const storage = memoryStorage();
  await guest.stashGuestOnboarding({ ...report, file: null }, storage, 0);
  assert.equal(guest.readGuestOnboarding(storage, guest.GUEST_ONBOARDING_MAX_AGE_MS + 1), null);
  assert.equal(storage.items.size, 0);
});

test('blocked or corrupt storage never throws', async () => {
  assert.equal(await guest.stashGuestOnboarding({ ...report, file: null }, null), false);
  assert.equal(guest.readGuestOnboarding(null), null);
  const storage = memoryStorage();
  storage.items.set('kareerly.guestOnboarding', '{not json');
  assert.equal(guest.readGuestOnboarding(storage), null);
});
