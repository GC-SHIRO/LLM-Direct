import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { apply } from './index.js';

let route, dispose;
apply({ effect(f) { dispose = f(); }, connection: { fetch: { register(r) { route = r; } } } }, { projectDir: resolve(import.meta.dirname, '..') });
assert.equal(route.path, '/api/llm-direct-workbench/call');
const send = (body) => route.fetch(new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const call = async (tool, args = {}) => {
  const response = await send({ tool, args });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
};
try {
  assert.equal((await send({ tool: 'get_state', args: {}, extra: 'a'.repeat(4096) })).status, 413);
  assert.equal((await send({ tool: 'unknown', args: {} })).status, 502);
  const first = (await call('get_state', { arm: 'both' })).data;
  assert.equal(first.mock, true);
  assert.equal(first.mode, 'auto');
  assert.deepEqual(Object.keys(first.arms), ['left', 'right']);
  assert.match((await call('get_images')).image, /^data:image\/jpeg;base64,\/9j\//);
  const move = await call('move_relative', { arm: 'left', dz: -5 });
  assert.equal(move.data.ok, true);
  assert.equal(move.data.state.tcp_pose.z, first.arms.left.tcp_pose.z - 5);
  assert.ok(move.image);
  assert.equal((await call('move_relative', { arm: 'left', dz: -100 })).data.ok, false);
  assert.equal((await call('gripper', { arm: 'right', opening: 0 })).data.final_opening, 0);
  assert.equal((await call('move_to_named', { arm: 'left', pose: 'reset' })).data.ok, true);
  assert.equal((await call('stop', { arm: 'both' })).data.ok, true);
  console.log('PASS: DSH route adapter → MCP stdio → mock state, JPEG, motion, limits, gripper, reset and stop');
} finally { dispose(); }
assert.equal((await send({ tool: 'get_state', args: {} })).status, 502);
