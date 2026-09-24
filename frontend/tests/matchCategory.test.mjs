import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/matchScoring.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { matchCategoryLabel } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const snapshotSource = readFileSync(new URL('../src/components/SnapshotStep.tsx', import.meta.url), 'utf8');

test('the backend category is shown regardless of the percentage', () => {
  assert.equal(matchCategoryLabel({ match_category: 'Aspiration', match_percentage: 31 }, 'aspiration'), 'Aspiration');
  assert.equal(matchCategoryLabel({ match_type: 'Aspiration', match_percentage: 0 }, 'aspiration'), 'Aspiration');
  assert.equal(matchCategoryLabel({ match_category: 'Fit-Now', match_type: 'Aspiration' }, 'aspiration'), 'Fit-Now');
});

test('older reports without a category fall back to the list they came from', () => {
  assert.equal(matchCategoryLabel({ match_percentage: 45 }, 'aspiration'), 'Aspiration');
  assert.equal(matchCategoryLabel({ match_category: ' ' }, 'fit_now'), 'Fit-Now');
  assert.equal(matchCategoryLabel(null, 'fit_now'), 'Fit-Now');
});

test('the snapshot no longer derives a category from the percentage', () => {
  assert.doesNotMatch(snapshotSource, /Partial Match/);
  assert.match(snapshotSource, /matchCategoryLabel\(match, matchType\)/);
});
