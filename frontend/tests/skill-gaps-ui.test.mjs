import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Skills page (Gaps and Learning tabs) and the resume summary card, rendered
// from fixture reports shaped like POST /api/skills/gaps responses.
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

async function loadUtility(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const deps = {
  ...React,
  ...require('@fortawesome/free-solid-svg-icons'),
  ...require('@fortawesome/react-fontawesome'),
  ...await loadUtility('../src/lib/matchScoring.ts'),
  ...await loadUtility('../src/lib/uiData.ts'),
  ...await loadUtility('../src/lib/jobDescription.ts'),
  ...await loadUtility('../src/lib/phProvinces.ts'),
  ...await loadUtility('../src/lib/matchDisclaimer.ts'),
  React,
};

function importedNames(parsed) {
  return parsed.statements.filter(ts.isImportDeclaration).flatMap((node) => {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return [];
    const names = clause.name ? [clause.name.text] : [];
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text));
    if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
    return names;
  });
}

function reexportedNames(parsed) {
  return parsed.statements
    .filter((node) => ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause))
    .flatMap((node) => node.exportClause.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text));
}

// Transpile one module with its imports resolved from `deps`; its exports join `deps`.
async function loadModule(path, defaultName = '') {
  globalThis.__skillGapsTestDeps = deps;
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const reexports = reexportedNames(parsed);
  const names = [...new Set(['React', ...importedNames(parsed), ...reexports])];
  const declarations = names.map((name) => `const ${name} = globalThis.__skillGapsTestDeps.${name};`).join('\n');
  const { outputText } = ts.transpileModule(`${declarations}\n${source}\n${reexports.length ? `export { ${reexports.join(', ')} };` : ''}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React },
    transformers: { before: [() => (node) => ts.factory.updateSourceFile(node, node.statements.filter((statement) => !ts.isImportDeclaration(statement) && !(ts.isExportDeclaration(statement) && statement.moduleSpecifier)))] },
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  delete globalThis.__skillGapsTestDeps;
  Object.assign(deps, module);
  if (defaultName) deps[defaultName] = module.default;
  return module;
}

const candidate = (name) => `../src/pages/candidate/${name}`;
const ui = (name) => `../src/components/ui/${name}`;
const page = {};
for (const entry of [
  candidate('model.ts'), candidate('skillGaps.ts'),
  ui('hooks.ts'), ui('controls.tsx'), ui('feedback.tsx'), [ui('Modal.tsx'), 'Modal'], ui('page.tsx'),
  candidate('common.tsx'), '../src/components/MatchScoreNotice.tsx', candidate('SkillGapsPage.tsx'), candidate('LearningPage.tsx'), candidate('ResumeSummaryCard.tsx'),
]) {
  const [path, defaultName] = Array.isArray(entry) ? entry : [entry, ''];
  Object.assign(page, await loadModule(path, defaultName));
}

const RULES = {
  tiers: [
    { id: 'close_first', label: 'Close these first', rule: 'Required by 2 or more of your jobs.' },
    { id: 'worth_next', label: 'Worth doing next', rule: 'Required by 1 job, or nice to have for 2 or more.' },
    { id: 'nice_extras', label: 'Nice extras', rule: 'Nice to have for 1 job.' },
  ],
  scopes: [
    { id: 'default', label: 'Fit-Now, saved and applied jobs' }, { id: 'fit_now', label: 'Fit-Now matches' },
    { id: 'saved', label: 'Saved and applied jobs' }, { id: 'all', label: 'All matches' },
  ],
  sort_order: [],
  display: { tier_limits: { close_first: 5, worth_next: 3, nice_extras: 0 }, search_min_open_gaps: 10, courses_per_skill_visible: 3, learning_skills_visible: 5 },
};

function skill(id, tier, { required = 0, nice = 0, name = `Skill ${id}` } = {}) {
  const jobs = [
    ...Array.from({ length: required }, (_, index) => ({ job_id: `r${id}-${index}`, job_source: 'internal', title: `Required job ${index}`, company: 'Acme', match_pct: 80 - index, requirement: 'required', match_type: 'fit_now' })),
    ...Array.from({ length: nice }, (_, index) => ({ job_id: `n${id}-${index}`, job_source: 'internal', title: `Nice job ${index}`, company: 'Acme', match_pct: 60 - index, requirement: 'nice_to_have', match_type: 'aspiration' })),
  ];
  const total = required + nice;
  return {
    skill_id: `SK${id}`, taxonomy_skill_id: `SK${id}`, skill_name: name, tier,
    tier_label: RULES.tiers.find((item) => item.id === tier).label,
    required_jobs: required, nice_jobs: nice, jobs_needing: total, best_match_pct: 80,
    impact_label: total >= 3 ? 'High impact' : total === 2 ? 'Medium impact' : 'Low impact', impact_bars: Math.min(3, total), jobs,
  };
}

function report(skills, extra = {}) {
  return {
    scope: 'default', group_by: 'skill', rules: RULES,
    totals: { in_scope_jobs: 10, jobs_with_gaps: 8, gap_free_jobs: 2, gap_free_fit_now_jobs: 2, open_skills: skills.length,
      by_tier: { close_first: 0, worth_next: 0, nice_extras: 0 }, unmatched_saved_jobs: 0 },
    scope_counts: { default: skills.length, fit_now: 1, saved: 0, all: skills.length },
    all_skills: skills.map((item) => ({ skill_id: item.skill_id, skill_name: item.skill_name })),
    skills, courses_by_skill: {}, ...extra,
  };
}

// 32 open gaps: 12 close-first, 10 worth-next, 10 nice extras.
const manySkills = [
  ...Array.from({ length: 12 }, (_, index) => skill(100 + index, 'close_first', { required: 2 + (index % 3) })),
  ...Array.from({ length: 10 }, (_, index) => skill(200 + index, 'worth_next', { required: 1 })),
  ...Array.from({ length: 10 }, (_, index) => skill(300 + index, 'nice_extras', { nice: 1 })),
];
const noop = () => {};

function renderGaps(props = {}) {
  return renderToStaticMarkup(React.createElement(page.SkillGapsPage, {
    report: report(manySkills), jobReport: null, status: 'ready', onRetry: noop, scope: 'default', onScope: noop,
    groupBy: 'skill', onGroupBy: noop, skillProgressRecords: {}, claimedSkills: {}, courseCompletions: {},
    onUpdateSkillProgress: noop, onMarkCourseTaken: noop, onUnmarkCourseTaken: noop, onAddSkillProof: noop,
    onClaimSkill: noop, onUnclaimSkill: noop, onOpenLearning: noop, onTab: noop, isDesktop: true, hasMatches: true,
    onOpenMatches: noop, ...props,
  }));
}

const rowCount = (html) => (html.match(/class="k-row k-gap-row"/g) || []).length;

test('with 30 or more open gaps the default view shows at most 8 skill rows', () => {
  const html = renderGaps();
  assert.equal(rowCount(html), 8);
  assert.equal(page.defaultVisibleRows(manySkills, RULES), 8);
  // Close these first shows 5 and Worth doing next 3; Nice extras starts as a heading only.
  assert.equal((html.match(/>Show 7 more</g) || []).length, 2);
  assert.match(html, /Show 10 skills/);
  // Search appears with more than 10 open gaps.
  assert.match(html, /type="search"/);
});

test('show more buttons say whether they are expanded and which list they control', () => {
  const html = renderGaps();
  const buttons = html.match(/<button[^>]*k-show-more[^>]*>/g) || [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.match(button, /aria-expanded="false"/);
    assert.match(button, /aria-controls="gap-tier-[a-z_]+"/);
  }
});

test('search ignores the tier limits, hides empty tiers and says when nothing matches', () => {
  const sections = page.buildTierSections(manySkills, RULES, {}, 'Skill 1');
  assert.deepEqual(sections.map((section) => section.tier), ['close_first']);
  assert.equal(sections[0].visible.length, 12);
  assert.equal(sections[0].hidden, 0);
  assert.deepEqual(page.buildTierSections(manySkills, RULES, {}, 'zzz'), []);
  const few = manySkills.slice(0, 4);
  assert.equal(page.showSkillSearch(few.length, RULES), false);
  assert.equal(page.showSkillSearch(11, RULES), true);
});

test('skills marked done or already owned move to Completed with an Undo', () => {
  const done = manySkills[0];
  const owned = manySkills[1];
  const progress = { [done.skill_id]: { skillName: done.skill_name, status: 'completed', progressPercent: 70, category: 'Other' } };
  const claimed = { [owned.skill_id]: { skillId: owned.skill_id, skillName: owned.skill_name, claimedAt: '2026-10-13' } };
  const { open, completed } = page.openAndCompleted(report(manySkills), claimed, progress);
  assert.equal(open.length, manySkills.length - 2);
  assert.deepEqual(completed.map((item) => item.reason).sort(), ['done', 'owned']);
  const html = renderGaps({ skillProgressRecords: progress, claimedSkills: claimed });
  assert.match(html, /Completed · 2/);
  assert.match(html, /aria-label="Undo: Skill 100"/);
  assert.match(html, /aria-label="Undo: Skill 101"/);
  // Still 8 open rows: the next skills in the tier take their place.
  assert.equal(rowCount(html), 8);
});

test('skills with uploaded proof count as the candidate\'s skills and stay listed once they leave the gaps', () => {
  const proof = { fileName: 'cert.pdf', uploadedAt: '2026-10-27' };
  // Proof for a skill that has a gap record updates that record (found by name).
  const gapRecord = { SK1: { skillId: 'SK1', skillName: 'Data Analysis', status: 'in_progress', progressPercent: 35, category: 'Other' } };
  const proven = page.withSkillProof(gapRecord, ' data analysis ', proof);
  assert.equal(proven.SK1.status, 'evidenced');
  assert.equal(proven.SK1.evidenceFilename, 'cert.pdf');
  assert.deepEqual(page.provenSkills(proven), { SK1: { skillId: 'SK1', skillName: 'Data Analysis', claimedAt: '2026-10-27' } });
  // Proof for any other skill adds a record for it.
  const added = page.withSkillProof({}, 'Canva', proof);
  assert.deepEqual(Object.values(page.provenSkills(added)).map((item) => item.skillName), ['Canva']);
  assert.deepEqual(page.withSkillProof({}, '   ', proof), {});
  // A certificate can name several skills; each counts. Link-only proof is named by its link.
  const linkProof = page.proofOf({ credentialProvider: 'Credly', uploadedAt: '2026-10-29' });
  assert.equal(linkProof.fileName, 'Credly link');
  const several = page.withSkillProof({}, 'Canva, Copywriting', linkProof);
  assert.deepEqual(Object.values(page.provenSkills(several)).map((item) => item.skillName).sort(), ['Canva', 'Copywriting']);
  assert.deepEqual(page.provenSkills(page.withoutProof(several, linkProof)), {});
  // Only proof (not Done or In progress) counts.
  assert.deepEqual(page.provenSkills(gapRecord), {});
  // Deleting the proof leaves the skill Done without proof, and it stops counting.
  const removed = page.withoutProof(proven, proof);
  assert.equal(removed.SK1.status, 'completed');
  assert.deepEqual(page.provenSkills(removed), {});
  assert.equal(page.withoutProof(proven, { fileName: 'other.pdf', uploadedAt: '2026-10-27' }), proven);

  // No longer a gap (matching now counts it), the skill stays under Completed with an Undo.
  const html = renderGaps({ skillProgressRecords: added });
  assert.match(html, /Completed · 1/);
  assert.match(html, /Proof uploaded · counts toward your matches/);
  assert.match(html, /aria-label="Undo: Canva"/);
});

test('a row shows its requirement, progress, job titles, job count and impact; the selected row is the detail', () => {
  const html = renderGaps({ report: report([skill(1, 'close_first', { required: 2, nice: 1, name: 'Business Analytics' })]) });
  assert.match(html, /Required by 2 jobs · nice to have for 1/);
  assert.match(html, /Not started/);
  assert.match(html, /Required job 0, Required job 1, Nice job 0/);
  assert.match(html, /3 jobs/);
  assert.match(html, /role="img" aria-label="High impact"/);
  assert.match(html, /aria-current="true"/);
  // Detail panel: explanation, needed-by list, the claim box, learning and progress.
  assert.match(html, /Required by 2 of your jobs, and nice to have for 1 more, so learning it once helps all 3 at the same time\./);
  assert.match(html, /Needed by 3 jobs/);
  assert.match(html, /I already have this skill/);
  // Needed by shows 2 jobs, then "Show all"; the claim button sits beside the title.
  assert.equal((html.match(/<section class="mt-6" aria-label="Needed by[^"]*">[\s\S]*?<\/section>/)[0].match(/<li/g) || []).length, 2);
  assert.match(html, /aria-expanded="false" aria-controls="needed-by-SK1"[^>]*>Show all 3 jobs</);
  assert.match(html, /<h2 id="gap-detail-title"[^>]*>Business Analytics<\/h2><button[^>]*>.*I already have this skill/);
  assert.match(html, /No course yet\./);
  assert.match(html, /Track your progress/);
  assert.doesNotMatch(html, /type="search"/);
});

test('By Job lists Fit-Now cards, marks shared skills with +N and collapses Aspiration matches', () => {
  const jobReport = {
    ...report([]), group_by: 'job', skills: undefined,
    totals: { ...report([]).totals, gap_free_fit_now_jobs: 3 },
    jobs: [
      { job_id: 'f1', job_source: 'internal', title: 'Data Encoder', company: 'Acme', match_pct: 88, match_type: 'fit_now',
        gaps: [{ skill_id: 'SK1', skill_name: 'SQL', requirement: 'required', tier: 'close_first', other_jobs: 2 }] },
      { job_id: 'a1', job_source: 'internal', title: 'Analyst', company: 'Acme', match_pct: 55, match_type: 'aspiration',
        gaps: [{ skill_id: 'SK1', skill_name: 'SQL', requirement: 'required', tier: 'close_first', other_jobs: 2 }] },
    ],
  };
  const html = renderGaps({ groupBy: 'job', jobReport });
  assert.match(html, /Data Encoder/);
  assert.match(html, /\+2/);
  assert.match(html, /3 Fit-Now jobs have no gaps \(hidden\)\./);
  assert.match(html, /aria-expanded="false" aria-controls="gap-aspiration-list"[^>]*>Show 1 Aspiration match</);
  assert.match(html, /id="gap-aspiration-list" class="mt-2 space-y-3" hidden=""/);
});

test('Learning groups courses by skill, shows 3 per skill and collapses skills with no course', () => {
  const course = (index) => ({ resource_id: `c${index}`, title: `SQL course ${index}`, matched_gap_skill_names: ['SQL'], matched_gap_skill_ids: ['SK1'], review_status: 'verified' });
  const sql = skill(1, 'close_first', { required: 2, name: 'SQL' });
  const jira = skill(2, 'worth_next', { required: 1, name: 'Jira' });
  const learning = report([sql, jira], {
    courses_by_skill: {
      SK1: { skill_id: 'SK1', taxonomy_skill_id: 'SK1', skill_name: 'SQL', helps_matches: 2, required_by: ['Required job 0', 'Required job 1'], nice_for: [], courses: [0, 1, 2, 3, 4].map(course), search_url: 'https://duckduckgo.com/?q=SQL+course' },
      SK2: { skill_id: 'SK2', taxonomy_skill_id: 'SK2', skill_name: 'Jira', helps_matches: 1, required_by: ['Required job 0'], nice_for: [], courses: [], search_url: 'https://duckduckgo.com/?q=Jira+course' },
    },
  });
  const html = renderToStaticMarkup(React.createElement(page.UpskillingPage, {
    report: learning, status: 'ready', onRetry: noop, claimedSkills: {}, skillProgressRecords: {}, hasMatches: true,
    courseCompletions: {}, onMarkCourseTaken: noop, onUnmarkCourseTaken: noop, onUploadCourseEvidence: noop, onTab: noop, onOpenJobMatches: noop,
  }));
  assert.doesNotMatch(html, /For job/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /2 jobs · Required: Required job 0, Required job 1/);
  assert.equal((html.match(/class="k-label">SQL course \d/g) || []).length, 3);
  assert.match(html, /aria-expanded="false"[^>]*>Show 2 more courses</);
  assert.match(html, /No course yet for 1 skill/);
  assert.doesNotMatch(html, /more skills?</);
  assert.match(html, /href="https:\/\/duckduckgo.com\/\?q=Jira\+course"/);
});

test('the resume card asks "Does this sound like you?" and thanks the candidate after an answer', () => {
  const summary = {
    summary_version: 'v1', resume_version: 'sha256:abc', sentences: ['A.', 'B.'], summary: 'Your resume shows 3 skills.',
    top_skills: ['Excel', 'SQL'], experience_level: { value: 'entry', label: 'Entry level', source: 'step3_job_level' },
    best_fit_roles: ['Data Encoder'], roles_basis: 'fit_now', feedback_reasons: [],
  };
  const props = { summary, status: 'ready', saving: false, onVote: async () => true, onFixSkills: noop };
  const asking = renderToStaticMarkup(React.createElement(page.ResumeSummaryCard, { ...props, vote: null }));
  assert.match(asking, /Your resume at a glance/);
  assert.match(asking, /Does this sound like you\?/);
  assert.match(asking, />Yes</);
  assert.match(asking, />Not quite</);
  assert.match(asking, /Entry level/);
  const answered = renderToStaticMarkup(React.createElement(page.ResumeSummaryCard, { ...props, vote: { rating: 'yes', reasons: [], comment: '' } }));
  assert.match(answered, /Thanks for your feedback\./);
  assert.match(answered, /Change answer/);
});

test('Skills page copy has no em dashes and every control is a real button, link or input', () => {
  for (const file of ['SkillGapsPage.tsx', 'LearningPage.tsx', 'ResumeSummaryCard.tsx', 'skillGaps.ts']) {
    const source = readFileSync(new URL(candidate(file), import.meta.url), 'utf8');
    assert.doesNotMatch(source, /—/, file);
    assert.doesNotMatch(source, /<(div|span|li|p|section)\b[^>]*onClick/, file);
  }
});

test('Learning shows 5 skills with courses before "Show N more skills"', () => {
  const skills = Array.from({ length: 8 }, (_, index) => skill(400 + index, 'close_first', { required: 2, name: `Course skill ${index}` }));
  const courses_by_skill = Object.fromEntries(skills.map((item) => [item.skill_id, {
    skill_id: item.skill_id, taxonomy_skill_id: item.skill_id, skill_name: item.skill_name, helps_matches: 2, required_by: ['A'], nice_for: [],
    courses: [{ resource_id: `c-${item.skill_id}`, title: `Course for ${item.skill_name}`, matched_gap_skill_names: [item.skill_name], matched_gap_skill_ids: [item.skill_id] }],
    search_url: '',
  }]));
  const html = renderToStaticMarkup(React.createElement(page.UpskillingPage, {
    report: report(skills, { courses_by_skill }), status: 'ready', onRetry: noop, claimedSkills: {}, skillProgressRecords: {}, hasMatches: true,
    courseCompletions: {}, onMarkCourseTaken: noop, onUnmarkCourseTaken: noop, onUploadCourseEvidence: noop, onTab: noop, onOpenJobMatches: noop,
  }));
  assert.equal((html.match(/<h2 id="learn-sk4\d\d-title"/g) || []).length, 5);
  assert.match(html, /aria-expanded="false" aria-controls="learn-skill-groups">Show 3 more skills</);
  // The skill filter is a dropdown with every skill that has courses.
  assert.match(html, /<option value="all" selected="">All skills \(8\)<\/option>/);
  assert.equal((html.match(/<option /g) || []).length, 9);
  assert.doesNotMatch(html, /k-chip-scroller/);
  // Search on the left, dropdown on the right; no intro or "Show courses for" text.
  assert.match(html, /<div class="k-learn-controls mb-5"><div class="k-search" role="search">[\s\S]*?<\/div><select class="k-select" aria-label="Show courses for"/);
  assert.doesNotMatch(html, /most useful first/);
  assert.doesNotMatch(html, />Show courses for</);
});

test('skill progress labels follow the thesis ranges (0 / 1-25 / 26-50 / 51-75)', () => {
  const source = readFileSync(new URL('../src/pages/candidate/model.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function skillProgressLabel'));
  const fn = new Function(`${ts.transpileModule(body.slice(0, body.indexOf('\n}\n') + 3).replace('export ', ''), { compilerOptions: { target: 'es2020' } }).outputText}; return skillProgressLabel;`)();
  assert.equal(fn(0), 'Not Started / Missing');
  assert.equal(fn(1), 'Foundation Progress');
  assert.equal(fn(25), 'Foundation Progress');
  assert.equal(fn(26), 'Intermediate Progress');
  assert.equal(fn(50), 'Intermediate Progress');
  assert.equal(fn(51), 'Advanced Progress');
  assert.equal(fn(75), 'Advanced Progress');
  assert.equal(fn(76), 'Skill Covered');
});
