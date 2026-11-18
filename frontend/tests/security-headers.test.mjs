// Security headers served by Vercel (frontend/vercel.json; audit SEC-07/08).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headers = Object.fromEntries(config.headers.find((rule) => rule.source === '/(.*)').headers.map((h) => [h.key, h.value]));
const directives = (policy) => Object.fromEntries(policy.split(';').map((part) => part.trim()).filter(Boolean)
  .map((part) => { const [name, ...values] = part.split(/\s+/); return [name, values]; }));

test('every page is sent with the basic protections', () => {
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
  const enforced = directives(headers['Content-Security-Policy']);
  assert.deepEqual(enforced['frame-ancestors'], ["'none'"]);
  assert.deepEqual(enforced['object-src'], ["'none'"]);
  assert.deepEqual(enforced['base-uri'], ["'self'"]);
});

test('the SPA rewrite is kept', () => {
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
});

test('the full policy allows the inline script exactly as index.html has it', () => {
  // Editing the inline snippet changes its hash; update the policy with it.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
  const policy = directives(headers['Content-Security-Policy-Report-Only']);
  for (const script of inline) {
    const hash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
    assert.ok(policy['script-src'].includes(hash), `script-src lacks ${hash}`);
  }
  assert.ok(!policy['script-src'].includes("'unsafe-inline'"));
  assert.ok(!policy['script-src'].includes("'unsafe-eval'"));
});

test('the full policy reaches the services the app uses', () => {
  const policy = directives(headers['Content-Security-Policy-Report-Only']);
  for (const host of ['https://dgnxigotdpqiwohocloi.supabase.co', 'https://kareerlyph.cloud.run']) {
    assert.ok(policy['connect-src'].includes(host), `connect-src lacks ${host}`);
  }
  assert.ok(policy['style-src'].includes('https://fonts.googleapis.com'));
  assert.ok(policy['font-src'].includes('https://fonts.gstatic.com'));
  // Resume previews are blob: iframes.
  assert.ok(policy['frame-src'].includes('blob:'));
});
