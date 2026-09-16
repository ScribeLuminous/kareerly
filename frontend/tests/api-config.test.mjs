import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
 .replace("import { defineConfig, loadEnv } from 'vite'", 'const defineConfig = value => value; const loadEnv = () => globalThis.kareerlyTestBuildEnv;')
 .replace("import react from '@vitejs/plugin-react'", 'const react = () => ({});')
 .replace('...process.env', '');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { default: config } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('Vercel builds require a public backend origin', () => {
 const base = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'fixture', VERCEL: '1' };
 try {
  for (const apiUrl of ['', 'http://127.0.0.1:8000', 'https://localhost:8000', 'https://backend.example.org/api', 'https://backend.example.org?test=1']) {
   globalThis.kareerlyTestBuildEnv = { ...base, VITE_API_BASE_URL: apiUrl };
   assert.throws(() => config({ mode: 'production', command: 'build' }), /VITE_API_BASE_URL/);
  }
  globalThis.kareerlyTestBuildEnv = { ...base, VITE_API_BASE_URL: 'https://backend.example.org/' };
  assert.doesNotThrow(() => config({ mode: 'production', command: 'build' }));
  globalThis.kareerlyTestBuildEnv = { ...base, VERCEL: undefined, VITE_API_BASE_URL: undefined };
  assert.doesNotThrow(() => config({ mode: 'development', command: 'serve' }));
 } finally { delete globalThis.kareerlyTestBuildEnv; }
});
