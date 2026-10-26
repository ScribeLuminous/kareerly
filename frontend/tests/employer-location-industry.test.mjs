import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const cache = new Map();
function moduleUrl(file) {
  const path = new URL(file).href;
  if (cache.has(path)) return cache.get(path);
  const output = ts.transpileModule(fs.readFileSync(new URL(path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace(/from '(\.{1,2}\/[^']+)'/g, (_match, specifier) => `from '${moduleUrl(new URL(`${specifier}.ts`, path))}'`);
  const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
  cache.set(path, url);
  return url;
}

const provinces = await import(moduleUrl(new URL('../src/lib/phProvinces.ts', import.meta.url)));
const cities = await import(moduleUrl(new URL('../src/lib/phCities.ts', import.meta.url)));
const options = await import(moduleUrl(new URL('../src/lib/employerOptions.ts', import.meta.url)));
const careerAreas = await import(moduleUrl(new URL('../src/lib/careerAreas.ts', import.meta.url)));
const regions = await import(moduleUrl(new URL('../src/lib/regionPreference.ts', import.meta.url)));

test('saved locations split into city and a listed province', () => {
  assert.deepEqual(provinces.splitLocation('Makati City, Metro Manila'), { city: 'Makati City', province: 'Metro Manila' });
  assert.deepEqual(provinces.splitLocation('Cebu City, cebu'), { city: 'Cebu City', province: 'Cebu' });
  assert.deepEqual(provinces.splitLocation('Taguig, NCR'), { city: 'Taguig', province: 'Metro Manila' });
  // Older free text is kept as it was typed.
  assert.deepEqual(provinces.splitLocation('Makati City'), { city: 'Makati City', province: '' });
  assert.deepEqual(provinces.splitLocation('Ortigas, Pasig, Somewhere'), { city: 'Ortigas', province: 'Pasig, Somewhere' });
  assert.deepEqual(provinces.splitLocation(''), { city: '', province: '' });
  assert.equal(provinces.joinLocation(' Lucena City ', 'Quezon'), 'Lucena City, Quezon');
  assert.equal(provinces.joinLocation('', 'Cavite'), 'Cavite');
});

test('province groups use the known region codes and list each province once', () => {
  const codes = new Set(regions.PH_REGIONS.map((region) => region.code));
  provinces.PH_PROVINCE_GROUPS.filter((group) => group.region).forEach((group) => assert.ok(codes.has(group.region), group.region));
  assert.equal(new Set(provinces.PH_PROVINCES).size, provinces.PH_PROVINCES.length);
  assert.equal(provinces.provinceRegion('Laguna'), 'IV-A');
  assert.equal(provinces.provinceRegion('Sulu'), '');
});

test('every listed province has its cities and municipalities', () => {
  provinces.PH_PROVINCES.forEach((province) => assert.ok(cities.provinceCities(province).length > 0, province));
  assert.ok(cities.provinceCities('Quezon').includes('Lucena City'));
  assert.ok(cities.provinceCities('Metro Manila').includes('Makati City'));
  // Highly urbanized cities sit under the province they lie in.
  assert.ok(cities.provinceCities('Cebu').includes('Cebu City'));
  assert.ok(cities.provinceCities('Davao del Sur').includes('Davao City'));
  assert.deepEqual(cities.provinceCities('Somewhere'), []);
});

test('a saved city takes the list spelling only within its province', () => {
  assert.equal(cities.canonicalCity('Quezon', ' lucena city '), 'Lucena City');
  assert.equal(cities.canonicalCity('Laguna', 'Lucena City'), '');
  assert.equal(cities.canonicalCity('Quezon', ''), '');
});

test('candidate and company profiles pick the city from the same province list', () => {
  for (const page of ['../src/pages/candidate/AccountSettingsPage.tsx', '../src/pages/employer/EmployerAccountPage.tsx']) {
    const source = fs.readFileSync(new URL(page, import.meta.url), 'utf8');
    assert.match(source, /<CityField\b/, page);
    // A new province keeps the city only when that province lists it.
    assert.match(source, /canonicalCity\(/, page);
  }
});

test('industries follow the career areas and carry PSOC groups', () => {
  assert.deepEqual(options.EMPLOYER_INDUSTRY_OPTIONS.map((option) => option.area), careerAreas.careerAreaOptions.map((option) => option.value));
  assert.equal(options.EMPLOYER_INDUSTRIES.at(-1), 'Other');
  options.EMPLOYER_INDUSTRY_OPTIONS.forEach((option) => {
    assert.ok(option.psoc.length > 0, option.label);
    option.psoc.forEach((group) => assert.match(group.code, /^\d{1,4}$/));
  });
  assert.deepEqual(options.industryPsocGroups('Technology & Data').map((group) => group.code), ['25', '35']);
  assert.deepEqual(options.industryPsocGroups('Other'), []);
});

test('industries saved from the old list move to the matching area', () => {
  assert.equal(options.normalizeEmployerIndustry('Finance & Banking'), 'Business & Office');
  assert.equal(options.normalizeEmployerIndustry('BPO & Customer Service'), 'Sales, Marketing & Customer Service');
  assert.equal(options.normalizeEmployerIndustry('technology & data'), 'Technology & Data');
  assert.equal(options.normalizeEmployerIndustry('Aerospace'), 'Aerospace');
  assert.equal(options.normalizeEmployerIndustry(null), '');
});
