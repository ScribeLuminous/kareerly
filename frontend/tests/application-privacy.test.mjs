// Applications are written only through the database's application functions,
// and the employer workspace never reads candidate identity from application
// rows (supabase/migrations/20261117090000_application_privacy_and_integrity.sql).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

async function loadUtility(path) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

// Each `.from('job_applications')` call with the chain that follows it.
function applicationTableCalls(source) {
  return source.split(".from('job_applications')").slice(1).map((rest) => rest.slice(0, 200));
}

for (const page of ['../src/pages/Dashboard.tsx', '../src/pages/EmployerDashboard.tsx']) {
  test(`${page.split('/').pop()} only reads job_applications directly`, () => {
    for (const call of applicationTableCalls(read(page))) {
      assert.doesNotMatch(call, /^\s*\.(insert|update|upsert|delete)\(/, `direct write: ${call}`);
    }
  });
}

test('candidates apply, withdraw and answer requests through the application functions', () => {
  const source = read('../src/pages/Dashboard.tsx');
  for (const fn of ['submit_job_application', 'withdraw_job_application', 'respond_to_message_request']) {
    assert.match(source, new RegExp(`rpc\\('${fn}'`));
  }
  assert.doesNotMatch(source, /candidate_(name|email|location)/);
});

test('the employer workspace reads identity only from get_employer_applicant_identities', () => {
  const dashboard = read('../src/pages/EmployerDashboard.tsx');
  const model = read('../src/pages/employer/model.ts');
  assert.match(dashboard, /rpc\('get_employer_applicant_identities'\)/);
  assert.match(dashboard, /\.select\(EMPLOYER_APPLICATION_COLUMNS\)/);
  const columns = model.match(/EMPLOYER_APPLICATION_COLUMNS =\s*'([^']+)'/)[1].split(',');
  assert.ok(!columns.some((column) => column.startsWith('candidate_')), columns.join(','));
  assert.ok(!columns.includes('*'));
  assert.doesNotMatch(dashboard, /candidate_(name|email|location)/);
  assert.doesNotMatch(model, /row\.candidate_(name|email|location)/);
});

test('the employer no longer writes the message request state itself', () => {
  assert.doesNotMatch(read('../src/pages/EmployerDashboard.tsx'), /message_request_state: 'pending'/);
});

test('application errors show the database message only for expected failures', async () => {
  const { applicationErrorMessage } = await loadUtility('../src/lib/applicationErrors.ts');
  const fallback = 'Unable to submit application. Please try again.';
  assert.equal(applicationErrorMessage({ code: '23505', message: 'duplicate key value' }, fallback), 'You have already applied for this job.');
  assert.equal(applicationErrorMessage({ code: 'P0002', message: 'This job is closed or no longer accepting applications.' }, fallback),
    'This job is closed or no longer accepting applications.');
  assert.equal(applicationErrorMessage({ code: '22023', message: 'There is no open message request for this application.' }, fallback),
    'There is no open message request for this application.');
  // Anything else (a missing function, a network error) gets the generic text.
  assert.equal(applicationErrorMessage({ code: 'PGRST202', message: 'Could not find the function' }, fallback), fallback);
  assert.equal(applicationErrorMessage(new Error('Failed to fetch'), fallback), fallback);
  assert.equal(applicationErrorMessage(null, fallback), fallback);
});
