import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(frontend);
const python = path.join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const health = 'http://127.0.0.1:8000/api/health';
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function launch(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'inherit' });
  children.add(child);
  child.on('error', error => { console.error(error.message); children.delete(child); stop(1); });
  child.on('exit', code => { children.delete(child); stop(code || 0); });
  return child;
}
async function ready() {
  try {
    const response = await fetch(health, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).status === 'ok';
  } catch { return false; }
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
try {
  if (!await ready()) {
    await access(python);
    launch(python, ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'], root);
    const deadline = Date.now() + 60000;
    while (!stopping && !await ready()) {
      if (Date.now() > deadline) throw new Error('Backend did not become ready within 60 seconds. Check the startup output above.');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!stopping) {
    console.log(`Matching backend ready: ${health}`);
    launch(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), ...process.argv.slice(2)], frontend);
  }
} catch (error) {
  console.error(`Local startup failed: ${error.message}\nInstall backend dependencies using backend/README.md, then retry.`);
  stop(1);
}
