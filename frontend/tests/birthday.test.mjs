import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/birthday.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const birthday = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const today = new Date(2026, 9, 27); // 27 Oct 2026, local time

test('the birthday picker stops at today, so the latest year is the current year', () => {
  assert.equal(birthday.maxBirthdayDate(0, today), '2026-10-27');
});

test('sign up allows birthdays up to exactly 18 years ago', () => {
  assert.equal(birthday.MIN_SIGNUP_AGE, 18);
  assert.equal(birthday.maxBirthdayDate(18, today), '2008-10-27');
  assert.equal(birthday.isOldEnough('2008-10-27', 18, today), true);
  assert.equal(birthday.isOldEnough('2008-10-28', 18, today), false);
  assert.equal(birthday.isOldEnough('1990-01-01', 18, today), true);
});

test('a Feb 29 today maps to Feb 28 in a non-leap year, never March 1', () => {
  const leapDay = new Date(2028, 1, 29);
  assert.equal(birthday.maxBirthdayDate(18, leapDay), '2010-02-28');
  assert.equal(birthday.isOldEnough('2010-03-01', 18, leapDay), false);
  assert.equal(birthday.maxBirthdayDate(20, leapDay), '2008-02-29');
});
