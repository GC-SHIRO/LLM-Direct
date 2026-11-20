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
const call = (tool, args = {}, secret = token, extra = {}) => route.fetch(new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, token: secret, tool, args, ...extra }) }));
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
  assert.equal(state.endpoint, endpoint); assert.equal(frame.endpoint, endpoint);
  const manual = (tool, args) => call(tool, args, token, { manual: true });
  assert.equal((await call('stop', { arm: 'both' }, token, { manual: true, token: undefined })).status, 403);
  for (const [tool, args] of [['move_relative', { arm: 'left', dx: 1 }], ['move_relative', { arm: 'left', dx: 5, dy: 5 }], ['gripper', { arm: 'left', opening: 0.5 }], ['move_to_named', { arm: 'both', pose: 'reset' }], ['stop', { arm: 'left' }]]) {
    assert.equal((await manual(tool, args)).status, 400);
  }
  const actions = [['move_relative', { arm: 'left', dx: 5, with_image: false }], ['gripper', { arm: 'right', opening: 1, with_image: true }], ['move_to_named', { arm: 'left', pose: 'reset', with_image: false }], ['stop', { arm: 'both' }]];
  for (const [tool, args] of actions) {
    const result = await (await manual(tool, args)).json();
    assert.equal(result.endpoint, endpoint, JSON.stringify(result)); assert.equal(result.data?.ok, true, JSON.stringify(result.data));
    if (args.with_image) assert.match(result.image, /^data:image\/jpeg;base64,\/9j\//);
  }
  console.log('PASS authenticated mock reads, endpoint echo, guarded manual controls, invalid requests');
} finally { dispose(); child.kill(); await exited; }
