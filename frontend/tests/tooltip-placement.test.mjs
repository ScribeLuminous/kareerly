import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/components/ui/placement.ts', import.meta.url), 'utf8');
const { placeTooltip } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64'));

const viewport = { width: 1000, height: 700 };
const panel = { width: 300, height: 120 };
const inside = (spot) => spot.left >= 8 && spot.top >= 8 && spot.left + panel.width <= viewport.width - 8 && spot.top + panel.height <= viewport.height - 8;

test('a tooltip next to a button near the left edge stays on screen', () => {
  // The reported case: an info icon at the left of a dialog, panel aligned to the right edge of the button.
  const spot = placeTooltip({ top: 200, left: 12, right: 44, bottom: 232 }, panel, viewport, 'right');
  assert.equal(spot.left, 8);
  assert.ok(inside(spot));
});

test('a tooltip next to a button near the right edge stays on screen', () => {
  const spot = placeTooltip({ top: 200, left: 960, right: 992, bottom: 232 }, panel, viewport, 'left');
  assert.equal(spot.left, 1000 - 300 - 8);
  assert.ok(inside(spot));
});

test('it opens below the button, or above when there is no room below', () => {
  assert.equal(placeTooltip({ top: 100, left: 400, right: 432, bottom: 132 }, panel, viewport, 'left').top, 138);
  const low = placeTooltip({ top: 620, left: 400, right: 432, bottom: 652 }, panel, viewport, 'left');
  assert.equal(low.top, 620 - 6 - 120);
  assert.ok(inside(low));
});

test('a viewport narrower than the panel still never starts off screen', () => {
  const spot = placeTooltip({ top: 100, left: 10, right: 42, bottom: 132 }, { width: 300, height: 100 }, { width: 280, height: 600 }, 'right');
  assert.equal(spot.left, 8);
});

test('the info tip positions its panel against the viewport so a dialog cannot clip it', () => {
  const controls = fs.readFileSync(new URL('../src/components/ui/controls.tsx', import.meta.url), 'utf8');
  assert.match(controls, /position: 'fixed'/);
  assert.match(controls, /placeTooltip\(/);
});
