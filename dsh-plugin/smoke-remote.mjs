// End-to-end through the DSH handler against an authenticated, loopback-only Python mock.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { apply } from './index.js';
const root = resolve(import.meta.dirname, '..');
const listener = createServer();
listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = listener.address().port; await new Promise(done => listener.close(done));
const endpoint = `http://127.0.0.1:${port}/mcp`, token = randomBytes(18).toString('hex');
const child = spawn(join(root, '.venv', 'Scripts', 'python.exe'), ['-m', 'llm_direct.server', '--mock', '--mode', 'auto', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, LLM_DIRECT_TOKEN: token }, stdio: 'ignore', windowsHide: true });
const exited = once(child, 'exit');
let route, dispose;
apply({ effect(f) { dispose = f(); }, connection: { fetch: { register(r) { route = r; } } } }, { projectDir: root });
const call = (tool, args = {}, secret = token) => route.fetch(new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, token: secret, tool, args }) }));
try {
  let up = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Python mock failed to start');
    try { if ((await fetch(endpoint)).status === 401) { up = true; break; } } catch { /* starting */ }
    await delay(100);
  }
  assert.ok(up, 'mock HTTP server must require authentication');
  assert.notEqual((await call('get_state', {}, 'incorrect')).status, 200);
  assert.equal((await call('stop')).status, 403);
  const state = await (await call('get_state', { arm: 'both' })).json(); assert.equal(state.data?.mock, true, JSON.stringify(state));
  const frame = await (await call('get_images', { grid: false })).json(); assert.match(frame.image || '', /^data:image\/jpeg;base64,\/9j\//);
  console.log('PASS authenticated remote state and JPEG, bad token and remote stop rejected');
} finally { dispose(); child.kill(); await exited; }
