import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8')
  .replace("import { supabase } from './supabase';", `const supabase = { auth: { signInWithPassword: async () => { throw new TypeError('Failed to fetch'); } } };`);
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const auth = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('network failures are distinguished from rejected credentials', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'fetch failed']) {
    assert.match(auth.getFriendlyAuthErrorMessage(new TypeError(message)), /Unable to reach the sign-in service/);
  }
  assert.match(auth.getFriendlyAuthErrorMessage({ name: 'AuthRetryableFetchError', message: 'temporary outage' }), /Unable to reach/);
  assert.match(auth.getFriendlyAuthErrorMessage({ message: 'Invalid login credentials', status: 400 }), /Invalid email or password/);
  assert.match(auth.getFriendlyAuthErrorMessage({ message: 'Email not confirmed', status: 400 }), /confirm your email/);
});

test('a rejected auth request resets the verification state', async () => {
  await assert.rejects(auth.signInWithEmail('test@example.com', 'unused', 'candidate'), /Failed to fetch/);
  assert.equal(auth.getAuthStatus(), 'signed_out');
});
