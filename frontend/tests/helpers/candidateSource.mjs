import { readdirSync, readFileSync } from 'node:fs';

// The candidate workspace lives in src/pages/Dashboard.tsx (state and data flow)
// and src/pages/candidate/* (pages, components and pure helpers). Source-level
// assertions read them together so they do not depend on which file holds code.
const candidateDir = new URL('../../src/pages/candidate/', import.meta.url);

export const candidateFiles = [
  new URL('../../src/pages/Dashboard.tsx', import.meta.url),
  ...readdirSync(candidateDir)
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .sort()
    .map((name) => new URL(name, candidateDir)),
];

export function readCandidateSource() {
  return candidateFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
}

export function readCandidateFile(name) {
  return readFileSync(new URL(name, candidateDir), 'utf8');
}
