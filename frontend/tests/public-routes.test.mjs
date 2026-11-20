// URLs of the signed-out screens (src/lib/publicRoutes.ts; audit UX-01).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(read('../src/lib/publicRoutes.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const routes = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('every public screen has its own path and the path leads back to it', () => {
  const paths = Object.values(routes.PUBLIC_VIEW_PATHS);
  assert.equal(new Set(paths).size, paths.length);
  for (const [view, path] of Object.entries(routes.PUBLIC_VIEW_PATHS)) {
    assert.equal(routes.publicViewFromPath(path), view);
    if (path !== '/') assert.equal(routes.publicViewFromPath(`${path}/`), view, 'a trailing slash is the same page');
  }
});

test('workspace and unknown paths are not public screens', () => {
  for (const path of ['/candidate/dashboard', '/employer/jobs', '/admin/dashboard', '/reset-password', '/nope', '/signup/other']) {
    assert.equal(routes.publicViewFromPath(path), null, path);
  }
});

test('password recovery remembers which login it returns to', () => {
  assert.equal(routes.passwordRecoveryPath('candidate'), '/forgot-password');
  assert.equal(routes.passwordRecoveryPath('employer'), '/forgot-password?account=employer');
  assert.equal(routes.recoveryAccountFromSearch('?account=employer'), 'employer');
  assert.equal(routes.recoveryAccountFromSearch('?account=admin'), 'admin');
  assert.equal(routes.recoveryAccountFromSearch('?account=root'), 'candidate');
  assert.equal(routes.recoveryAccountFromSearch(''), 'candidate');
});

test('the app gives each signed-out screen its URL and follows Back and Forward', () => {
  const app = read('../src/App.tsx');
  for (const view of ['candidate-signup', 'employer-signup', 'signup-default', 'candidate-login', 'employer-login', 'admin-login']) {
    assert.match(app, new RegExp(`goToPublicView\\('${view}'\\)`), view);
  }
  assert.match(app, /goToPublicView\('password-recovery', passwordRecoveryPath\(authRole\)\)/);
  assert.match(app, /addEventListener\('popstate'/);
  // Recovery no longer sends the visitor to "/" while showing the recovery form.
  assert.doesNotMatch(app, /setView\('password-recovery'\);\s*navigate\('\/'/);
});

test('a login URL returns only to the app\'s own workspace pages', () => {
  const isCandidatePage = (path) => ['/candidate/dashboard', '/candidate/matches'].includes(path);
  assert.equal(routes.loginPathFor('candidate', '/candidate/matches'), '/candidate/login?next=%2Fcandidate%2Fmatches');
  assert.equal(routes.loginPathFor('employer', '/employer/jobs'), '/employer/login?next=%2Femployer%2Fjobs');
  assert.equal(routes.safeNextPath('?next=%2Fcandidate%2Fmatches', isCandidatePage), '/candidate/matches');
  assert.equal(routes.safeNextPath('?next=/candidate/matches?tab=x', isCandidatePage), '/candidate/matches');
  for (const next of ['https://evil.example/candidate/matches', '//evil.example/candidate/matches', '/\\evil.example', '/admin/dashboard', '', 'candidate/matches']) {
    assert.equal(routes.safeNextPath(`?next=${encodeURIComponent(next)}`, isCandidatePage), null, next);
  }
});

test('each screen has its own browser-tab title', async () => {
  const { outputText } = ts.transpileModule(read('../src/lib/pageTitles.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  const { pageTitle } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  assert.equal(pageTitle('landing', '/'), 'Kareerly - Find the job that fits you');
  assert.equal(pageTitle('candidate-login', '/candidate/login'), 'Log in - Kareerly');
  assert.equal(pageTitle('dashboard', '/candidate/skills/learning'), 'Learning - Kareerly');
  assert.equal(pageTitle('dashboard', '/candidate/skills'), 'Skills - Kareerly');
  assert.equal(pageTitle('employer-dashboard', '/employer/jobs/EMP-1/edit'), 'Jobs - Kareerly');
  assert.equal(pageTitle('employer-dashboard', '/employer/jobs/assessments'), 'Assessment templates - Kareerly');
  const titles = ['/', '/candidate/login', '/employer/login', '/signup', '/forgot-password'].map((path, i) =>
    pageTitle(['landing', 'candidate-login', 'employer-login', 'signup-default', 'password-recovery'][i], path));
  assert.equal(new Set(titles).size, titles.length);
});

test('signed-out workspace links go to the right login and come back after it', () => {
  const app = read('../src/App.tsx');
  assert.match(app, /navigate\(loginPathFor\(account, location\.pathname\), \{ replace: true \}\)/);
  assert.match(app, /safeNextPath\(window\.location\.search, isCandidateWorkspacePath\) \|\| '\/candidate\/dashboard'/);
  assert.match(app, /safeNextPath\(window\.location\.search, isEmployerWorkspacePath\) \|\| '\/employer\/dashboard'/);
  assert.match(app, /document\.title = pageTitle\(view, location\.pathname\)/);
});
