import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/passwordRecoveryLink.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const link = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const origin = 'https://kareerly-ph.vercel.app';

test('an expired reset link is reported instead of ignored', () => {
  const parsed = link.parseRecoveryLink(`${origin}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=`);
  assert.deepEqual(parsed, { kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' });
  assert.match(link.describeRecoveryError('otp_expired'), /expired or was already used/);
});

test('a recovery session from the email link opens the reset screen', () => {
  assert.deepEqual(link.parseRecoveryLink(`${origin}/#access_token=abc&refresh_token=def&type=recovery`), { kind: 'session' });
  assert.deepEqual(link.parseRecoveryLink(`${origin}/reset-password?code=xyz`), { kind: 'session' });
});

test('a token-hash link is verified by the app', () => {
  assert.deepEqual(link.parseRecoveryLink(`${origin}/reset-password?token_hash=hash123&type=recovery`), { kind: 'token', tokenHash: 'hash123' });
});

test('ordinary pages and sign-in links are left alone', () => {
  assert.deepEqual(link.parseRecoveryLink(`${origin}/`), { kind: 'none' });
  assert.deepEqual(link.parseRecoveryLink(`${origin}/candidate/login`), { kind: 'none' });
  assert.deepEqual(link.parseRecoveryLink(`${origin}/#access_token=abc&type=signup`), { kind: 'none' });
});
