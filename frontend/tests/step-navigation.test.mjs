import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = fs.readFileSync(new URL('../src/components/StepArrowButton.tsx', import.meta.url), 'utf8');
let compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const name of ['react/jsx-runtime', '@fortawesome/free-solid-svg-icons', '@fortawesome/react-fontawesome']) {
  compiled = compiled.replaceAll(JSON.stringify(name), JSON.stringify(import.meta.resolve(name)));
  compiled = compiled.replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)));
}
const { default: StepArrowButton } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('circular navigation renders accessible back and next arrow buttons', () => {
  for (const [direction, icon] of [['back', 'arrow-left'], ['next', 'arrow-right']]) {
    const html = renderToStaticMarkup(createElement(StepArrowButton, { direction, label: `${direction} step`, onClick: () => {} }));
    assert.match(html, /type="button"/);
    assert.match(html, /class="step-arrow-button"/);
    assert.ok(html.includes(`aria-label="${direction} step"`));
    assert.ok(html.includes(`data-icon="${icon}"`));
    assert.doesNotMatch(html, /disabled=""/);
  }
});

test('loading and unavailable navigation cannot be activated', () => {
  for (const state of [{ disabled: true }, { loading: true }]) {
    const html = renderToStaticMarkup(createElement(StepArrowButton, { direction: 'next', label: 'Generate report', onClick: () => {}, ...state }));
    assert.match(html, /disabled=""/);
    if (state.loading) {
      assert.match(html, /aria-busy="true"/);
      assert.match(html, /data-icon="spinner"/);
    }
  }
});

test('all four onboarding steps use the shared arrow control', () => {
  for (const file of ['UploadZone', 'SurveyStep', 'SnapshotStep']) {
    const component = fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8');
    assert.match(component, /<StepArrowButton/);
    assert.doesNotMatch(component, /<span>Back<\/span>|<span>Next<\/span>|\n\s+Go Back\n/);
  }
});
