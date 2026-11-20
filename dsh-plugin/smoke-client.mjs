import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const kind = '@local/dsh-llm-direct-workbench';
let registration;
runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
});
assert.equal(registration.id, kind);
const plugin = registration.factory((key) => { assert.equal(key, 'react'); return { createElement() {} }; });
const effects = [], slots = new Map(), closed = [];
let type;
const opened = [{ sessionId: 's1', tabId: 'mine', kind }, { sessionId: 's2', tabId: 'other', kind: 'files' }];
plugin.apply({
  effect(f) { effects.push(f()); },
  locale: { register(namespace, copy) { assert.equal(copy.zh.title, '机器人工作台'); return () => {}; }, bind: () => key => key },
  sidebarRightTabs: { register(def) { type = def; return () => { type = null; }; } },
  slots: { inject(name, f) { return f(); }, register(def, body) { slots.set(def.name, [def.key, body]); return () => slots.delete(def.name); } },
  sidebarRight: { openTabs: { getSnapshot: () => opened }, closeIn(...args) { closed.push(args); } },
});
assert.equal(type.kind, kind);
assert.equal(type.guide[0].id, 'open');
assert.equal(slots.get('sidebar.right.pane.tab')[0], kind);
assert.equal(slots.get('sidebar.right.pane.tab.title')[0], kind);
for (const dispose of effects.reverse()) dispose();
assert.deepEqual(closed, [['s1', 'mine']]);
assert.equal(slots.size, 0);
assert.equal(type, null);
console.log('PASS: browser loader registration, guide, body/title slots and owned-tab disposal');
