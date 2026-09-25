import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const dataUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function compile(file, replacements = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  let compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const name of ['react', 'react/jsx-runtime', '@fortawesome/free-solid-svg-icons', '@fortawesome/react-fontawesome']) {
    replacements[name] = import.meta.resolve(name);
  }
  for (const [name, url] of Object.entries(replacements)) {
    compiled = compiled.replaceAll(JSON.stringify(name), JSON.stringify(url));
    compiled = compiled.replaceAll(`'${name}'`, JSON.stringify(url));
  }
  return dataUrl(compiled);
}

const filename = 'VeryLongUnbrokenResumeFilename'.repeat(8) + '.docx';
const noopModule = dataUrl('export const analyzeResume = () => {}; export const getCurrentKareerlyUser = () => {}; export const saveResumeAnalysis = () => {};');
const { default: UploadZone } = await import(compile('../src/components/UploadZone.tsx', {
  '../hooks/useOnboarding': dataUrl(`export const useOnboarding = () => ({state: {resumeFile: {name: ${JSON.stringify(filename)}, size: 1024}, isLoading: false, error: null}});`),
  '../lib/fileUtils': dataUrl('export const validateResumeFile = () => ({valid: true}); export const formatFileSize = () => "1 KB";'),
  '../lib/api': noopModule,
  '../lib/auth': noopModule,
  '../lib/userData': noopModule,
  '../lib/resumeFreshness': dataUrl('export const RESUME_FILE_ACCEPT = ".pdf,.docx,.doc"; export const extractionWarnings = () => [];'),
  './StepArrowButton': compile('../src/components/StepArrowButton.tsx'),
}));

test('selected resume keeps the full filename in a shrinking, wrapping container', () => {
  const html = renderToStaticMarkup(createElement(UploadZone));
  assert.ok(html.includes(filename));
  assert.match(html, /class="min-w-0 flex-1"/);
  assert.match(html, /\[overflow-wrap:anywhere\]/);
  assert.match(html, /aria-label="Remove resume"/);
});

test('analyze action remains circular and centered with its caption', () => {
  const html = renderToStaticMarkup(createElement(UploadZone));
  assert.match(html, /class="flex flex-col items-center gap-2"><button/);
  assert.match(html, /class="step-arrow-button"/);
  assert.match(html, /data-icon="arrow-right"/);
  assert.match(html, /Analyze resume/);
  assert.doesNotMatch(html, /items-end/);
});
