// End-to-end through the DSH handler against an authenticated, loopback-only Python mock.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createServer as mockHttp } from 'node:http';
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

// Inert protocol recorder. Change only the declared identity/mode, never load a driver.
let mode = 'auto', mock = false, issueSession = true, disconnect = false;
let serial = 0, stateReads = 0, dispatches = 0, pauseState;
const sessions = new Map();
const server = mockHttp(async (req, res) => {
  const session = req.headers['mcp-session-id'];
  const fail = () => { res.writeHead(400).end(); };
  if (req.headers.authorization !== `Bearer ${token}`) return fail();
  if (req.method === 'DELETE') { sessions.delete(session); res.writeHead(204).end(); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const { method, params, id } = JSON.parse(Buffer.concat(chunks));
  res.setHeader('content-type', 'application/json');
  const send = result => res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
  const data = x => send({ content: [{ type: 'text', text: JSON.stringify(x) }] });
  if (method === 'initialize') {
    if (issueSession) { const key = `fixture-${++serial}`; sessions.set(key, false); res.setHeader('mcp-session-id', key); }
    return send({ serverInfo: { name: 'llm-direct' }, protocolVersion: params.protocolVersion });
  }
  if (method === 'notifications/initialized') return res.writeHead(202).end();
  if (method !== 'tools/call' || !sessions.has(session)) return fail();
  if (params.name === 'get_state') {
    stateReads++; sessions.set(session, true);
    if (pauseState) { const { entered, resume } = pauseState; pauseState = undefined; entered(); await resume; }
    return data({ ok: true, mock, mode, arms: { left: { arm: 'left' }, right: { arm: 'right' } } });
  }
  dispatches++;
  if (!sessions.get(session)) return fail();
  if (disconnect) { req.socket.destroy(); return; }
  return data({ ok: true });
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
try {
  const target = `http://127.0.0.1:${server.address().port}/mcp`;
  const action = (tool = 'gripper') => call(tool, tool === 'stop' ? { arm: 'both' } : { arm: 'left', opening: 1 }, token, { endpoint: target, manual: true });
  for (const [isMock, declaredMode, tool, allowed] of [
    [false, 'auto', 'gripper', false], [false, 'dry_run', 'gripper', false], [false, 'supervised', 'gripper', true],
    [false, 'auto', 'stop', true], [false, 'dry_run', 'stop', true], [true, 'supervised', 'gripper', true],
    [true, 'dry_run', 'stop', false], ['true', 'auto', 'gripper', false],
  ]) {
    mock = isMock; mode = declaredMode;
    const before = dispatches, checked = stateReads;
    assert.equal((await action(tool)).ok, allowed); assert.equal(dispatches - before, Number(allowed)); assert.equal(stateReads - checked, 1);
  }
  mock = true; mode = 'auto';
  issueSession = false; const before = dispatches;
  assert.equal((await action()).ok, false); assert.equal(dispatches, before);
  issueSession = true; disconnect = true;
  assert.equal((await action()).status, 502); assert.equal(dispatches, before + 1, 'never replay after lost response');
  disconnect = false;
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  pauseState = { entered: entered.resolve, resume: resume.promise };
  const pending = action();
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error('Did not enter preflight'); })]);
    assert.equal((await action()).status, 409);
    assert.equal((await action('stop')).status, 200, 'stop has reserved capacity');
  } finally { resume.resolve(); }
  assert.equal((await pending).status, 409, 'stop cancels a motion still in preflight');
  assert.equal(dispatches, before + 2); assert.equal(sessions.size, 0);
  console.log('PASS loopback policy, same-session preflight, concurrency, stop priority and no replay');
} finally { await new Promise(done => server.close(done)); }
