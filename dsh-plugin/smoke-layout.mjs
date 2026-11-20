// Run: node dsh-plugin/smoke-layout.mjs (Node 22+; CHROMIUM_PATH optionally overrides browser discovery).
// Real Chromium layout/AX/input via CDP; no Playwright install, DSH profile, bundle write, or backend.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const read = name => readFileSync(new URL(`./client/${name}`, import.meta.url), 'utf8');
// Same source substitution as build.mjs, without touching the generated client.js.
const bundle = read('entry.js')
  .replace('/* WORKBENCH_SOURCE */', () => read('workbench.js').replace('export function mountWorkbench', 'function mountWorkbench'))
  .replace('/* WORKBENCH_STYLES */ null', () => JSON.stringify(read('workbench.css')));
const candidates = process.env.CHROMIUM_PATH ? [process.env.CHROMIUM_PATH] : [
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
    .flatMap(dir => ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'].map(exe => join(dir, exe))),
  '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const executable = candidates.find(existsSync);
assert(executable, 'No local Chromium found; set CHROMIUM_PATH to Edge, Chrome, or Chromium.');
assert.equal(typeof WebSocket, 'function', 'Node 22+ with WebSocket is required.');

async function until(probe, description, ms = 5000) {
  const deadline = Date.now() + ms;
  do {
    const result = await probe();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools WebSocket did not open')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools WebSocket connection failed')); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data);
    const handler = pending.get(reply.id);
    if (handler) handler(reply.error && new Error(reply.error.message), reply.result);
  });
  socket.addEventListener('close', () => {
    for (const handler of pending.values()) handler(new Error('DevTools WebSocket closed'));
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const request = ++id;
        const finish = (error, result) => {
          clearTimeout(timer);
          pending.delete(request);
          if (error) reject(error);
          else resolve(result);
        };
        const timer = setTimeout(() => finish(new Error(`DevTools timed out: ${method}`)), 8000);
        pending.set(request, finish);
        try { socket.send(JSON.stringify({ id: request, method, params })); } catch (error) { finish(error); }
      });
    },
  };
}

function prepareFixture() {
  // A stitched 4:1 JPEG with distinct thirds, generated entirely in the browser.
  const canvas = Object.assign(document.createElement('canvas'), { width: 480, height: 120 });
  const ctx = canvas.getContext('2d');
  ['#d33', '#3a3', '#36c'].forEach((color, n) => {
    ctx.fillStyle = color;
    ctx.fillRect(n * 160, 0, 160, 120);
  });
  const image = canvas.toDataURL('image/jpeg');
  const left = {
    robot_mode: 'IDLE', moving: false, gripper_opening: 0.35,
    tcp_pose: { x: 112.3, y: -223.4, z: 334.5, rx: 14.5, ry: -177.6, rz: 18.7 },
    joints_deg: [123.4, -22.3, 33.4, -144.5, 55.6, -66.7],
  };
  const right = { ...left, fault: 'SIMULATED_FAULT_WITH_A_LONG_UNBROKEN_DIAGNOSTIC_TOKEN' };
  window.calls = [];
  window.__DSH_TRANSPORT__ = {
    async fetch(path, init) {
      if (path !== 'api/llm-direct-workbench/call' || init.method !== 'POST') throw new Error('Unexpected request');
      const request = JSON.parse(init.body);
      window.calls.push(request);
      switch (request.tool) {
        case 'get_state': return Response.json({ data: { ok: true, mock: true, mode: 'dry_run', arms: { left, right: window.healthy ? left : right } } });
        case 'get_images': return Response.json({ image });
        default: throw new Error(`Unexpected mock tool: ${request.tool}`);
      }
    },
  };
  // Hand the registered Body ordinary DOM nodes and the two React hooks it uses.
  const effects = [];
  const react = {
    useRef: current => ({ current }),
    useEffect: effect => effects.push(effect),
    createElement(tag, props, ...children) {
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(props || {})) {
        if (key === 'ref') value.current = el;
        else if (key === 'style') Object.assign(el.style, value);
        else el.setAttribute(key === 'className' ? 'class' : key, value);
      }
      el.append(...children);
      return el;
    },
  };
  window.__ModuleLoader__ = {
    load(registration) {
      let Body;
      registration.factory(name => {
        if (name !== 'react') throw new Error(`Unexpected module ${name}`);
        return react;
      }).apply({
        effect: action => action(),
        locale: { bind: () => key => key, register() {} },
        sidebarRightTabs: { register() {} },
        slots: { inject: (_name, action) => action(), register(def, body) {
          if (def.name === 'sidebar.right.pane.tab') Body = body;
        } },
      });
      document.querySelector('#sidebar').append(Body());
      const disposers = effects.map(effect => effect());
      window.disposeFixture = () => disposers.reverse().forEach(dispose => dispose?.());
    },
  };
}

function checkLayout() {
  const host = document.querySelector('.llmd-wb-host');
  const panel = host.querySelector('.llmd-wb');
  const frame = panel.querySelector('[data-frame]');
  const viewport = frame.parentElement;
  const failures = [];
  const require = (condition, message) => { if (!condition) failures.push(message); };
  const within = (inner, outer, axes = 'xy') =>
    (!axes.includes('x') || (inner.left >= outer.left - 1 && inner.right <= outer.right + 1)) &&
    (!axes.includes('y') || (inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1));
  host.scrollTop = 0;
  const outer = host.getBoundingClientRect();
  const content = panel.getBoundingClientRect();
  const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
  require(Math.abs(outer.width - sidebar.width) <= 1 && Math.abs(outer.height - sidebar.height) <= 1,
    `host ${outer.width}×${outer.height} does not match sidebar ${sidebar.width}×${sidebar.height}`);
  require(host.scrollWidth <= host.clientWidth + 1, `host horizontal overflow (${host.scrollWidth}/${host.clientWidth})`);
  require(panel.scrollWidth <= panel.clientWidth + 1, `panel horizontal overflow (${panel.scrollWidth}/${panel.clientWidth})`);
  require(within(content, outer, 'x'), 'panel extends horizontally beyond host');
  require(document.documentElement.scrollHeight <= innerHeight + 1, 'sidebar content scrolls the desktop page');
  // Allow wrapped diagnostics and an internal scrollbar, but not a second screen of content.
  require(host.scrollHeight <= host.clientHeight * 1.5, `excessive scrolling (${host.scrollHeight}/${host.clientHeight})`);
  const r = frame.getBoundingClientRect();
  require(r.width >= host.clientWidth * 0.6 && r.height >= 32 && within(r, viewport.getBoundingClientRect()),
    'stitched image is clipped, invisible, or too small for the sidebar');
  require(Math.abs(r.width - 4 * r.height) <= 4 || getComputedStyle(frame).objectFit === 'contain',
    `stitched image is stretched: ${r.width}×${r.height}`);
  for (const element of panel.querySelectorAll('h2, h3, button, select, input, dd, [role="status"], .llmd-wb__card')) {
    if (element.closest('dialog:not([open])')) continue; // tested separately in the top layer
    const bounds = element.getBoundingClientRect();
    const key = element.dataset.out || element.dataset.action || element.textContent.trim() || element.tagName;
    require(bounds.width > 0 && bounds.height > 0 && within(bounds, content), `${key} outside the workbench or hidden`);
    const card = element.closest('.llmd-wb__card');
    if (card && card !== element) require(within(bounds, card.getBoundingClientRect()), `${key} escapes its card`);
    require(element.scrollWidth <= element.clientWidth + 1, `${key} content overflows its own box`);
  }
  const stop = panel.querySelector('[data-action="stop"]');
  stop.scrollIntoView({ block: 'end' });
  require(within(stop.getBoundingClientRect(), host.getBoundingClientRect()), 'cannot reach stop control by scrolling');
  host.scrollTop = 0;
  return { failures, height: host.scrollHeight, available: host.clientHeight, image: `${Math.round(r.width)}×${Math.round(r.height)}` };
}

const profile = await mkdtemp(join(tmpdir(), 'llmd-layout-'));
const server = createServer((req, res) => {
  if (req.url !== '/') return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><meta charset="utf-8"><title>Workbench layout fixture</title>' +
    '<style>body{margin:0} #sidebar{height:550px;position:absolute;top:12px;right:12px}</style><main id="sidebar"></main>');
});
let browser, browserDone, cdp;
try {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  browser = spawn(executable, [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let startupError;
  browserDone = new Promise(resolve => {
    browser.once('exit', resolve);
    browser.once('error', error => { startupError = error; resolve(); });
  });
  const port = await until(async () => {
    if (startupError) throw startupError;
    if (browser.exitCode !== null) throw new Error(`Chromium exited before opening DevTools (code ${browser.exitCode})`);
    const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    return text.match(/^\d+/)?.[0];
  }, 'local Chromium DevTools port', 12000);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(6000) })).json();
  const target = targets.find(item => item.type === 'page' && item.url === 'about:blank');
  assert(target?.webSocketDebuggerUrl, 'Could not find the isolated Chromium page target');
  cdp = await connect(target.webSocketDebuggerUrl);
  const { product } = await cdp.send('Browser.getVersion');
  console.log(`Browser: ${product} (${executable})`);
  const evaluate = async expression => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const key = async (name, code, virtualKey) => {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: virtualKey });
    }
  };
  const ax = async selector => {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    assert(nodeId, `Missing ${selector}`);
    const { nodes: [node] } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    assert(node && !node.ignored, `${selector} is ignored in the Chromium accessibility tree`);
    return node;
  };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: origin });
  await until(() => evaluate(`location.href === ${JSON.stringify(origin)} && !!document.querySelector('#sidebar')`), 'fixture navigation');
  await evaluate(`(${prepareFixture})()`);
  await evaluate(bundle);
  await until(() => evaluate(`(() => {
    const img = document.querySelector('[data-frame]');
    return img && !img.hidden && img.complete && img.naturalWidth === 480;
  })()`), 'initial stitched camera frame');
  const $ = selector => `document.querySelector(${JSON.stringify(selector)})`;
  assert.equal(await evaluate(`${$('[data-language]')}.value`), 'zh', 'fresh profile defaults to Chinese');
  assert.deepEqual(await evaluate(`Array.from(${$('[data-language]')}.options, o => o.value).sort()`), ['en', 'zh']);
  assert.equal(await evaluate(`document.querySelectorAll('.llmd-wb img').length`), 1, 'one image for all cameras');
  assert.equal(await evaluate(`document.querySelectorAll('.llmd-wb [data-view]').length`), 0, 'no per-camera crop controls');
  assert.deepEqual(await evaluate('calls.slice(0, 2)'), [
    { tool: 'get_state', args: { arm: 'both' } }, { tool: 'get_images', args: { grid: false } },
  ]);
  assert.match(await evaluate(`${$('[data-out="left-pose"]')}.textContent`), /112\.3/);
  assert.match(await evaluate(`${$('[data-out="right-fault"]')}.textContent`), /SIMULATED_FAULT/);

  for (const lang of ['zh', 'en']) {
    assert.equal(await evaluate(`${$('[data-language]')}.value`), lang);
    assert.match(await evaluate(`${$('.llmd-wb')}.lang`), lang === 'zh' ? /^zh(?:-|$)/i : /^en(?:-|$)/i);
    assert.match(await evaluate(`${$('.llmd-wb h2')}.textContent`), lang === 'zh' ? /机器人工作台/ : /Robot Workbench/i);
    assert.match((await ax('[data-frame]')).name?.value || '', lang === 'zh' ? /顶.*左.*右/ : /top.*left.*right/i);
    for (const [selector, role] of [
      ['[data-language]', 'combobox'], ['[data-arm]', 'combobox'], ['[data-poll]', 'checkbox'],
      ['[data-action="refresh"]', 'button'], ['[data-action="stop"]', 'button'],
    ]) {
      const node = await ax(selector);
      assert.equal(node.role.value, role, selector);
      assert(node.name?.value.trim(), `Missing ${lang} accessible name for ${selector}`);
    }
    for (const selector of ['[data-out="status"]', '[data-out="feedback"]']) {
      assert.equal((await ax(selector)).role.value, 'status');
    }
    for (const width of [280, 320, 480]) {
      const result = await evaluate(`(async () => {
        document.querySelector('#sidebar').style.width = '${width}px';
        await document.fonts.ready;
        return (${checkLayout})();
      })()`);
      assert.deepEqual(result.failures, [], `${lang} ${width}×550: ${result.failures.join('; ')}`);
      const healthy = await evaluate(`(async () => {
        window.healthy = true;
        document.querySelector('[data-action="refresh"]').click();
        await new Promise(resolve => setTimeout(resolve, 20));
        const layout = (${checkLayout})();
        window.healthy = false;
        document.querySelector('[data-action="refresh"]').click();
        await new Promise(resolve => setTimeout(resolve, 20));
        return layout;
      })()`);
      assert.ok(healthy.height <= healthy.available + 1, `${lang} ${width}px normal view should fit on one screen (${healthy.height}/${healthy.available})`);
      console.log(`PASS ${lang} ${width}×550 (normal ${healthy.height}px; diagnostic ${result.height}px; image ${result.image})`);
    }
    if (lang === 'zh') {
      await evaluate(`${$('[data-language]')}.focus()`);
      await key('ArrowDown', 'ArrowDown', 40);
      await until(() => evaluate(`${$('[data-language]')}.value === 'en'`), 'keyboard language switch');
    }
  }

  const refresh = `${$('[data-action="refresh"]')}`;
  const axis = `${$('[data-action="jog"]')}`;
  const imageCount = await evaluate(`calls.filter(c => c.tool === 'get_images').length`);
  await evaluate(`${refresh}.click()`);
  await until(() => evaluate(`calls.filter(c => c.tool === 'get_images').length === ${imageCount + 1} && !${refresh}.disabled`), 'manual mock refresh');
  assert.equal(await evaluate(`${axis}.disabled`), false, 'ready mock arm allows jog');
  await evaluate(`${$('[data-arm]')}.focus()`);
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await evaluate(`${$('[data-arm]')}.value`), 'right');
  assert.equal(await evaluate(`${axis}.disabled`), true, 'faulted mock arm blocks jog');
  const polls = await evaluate(`calls.filter(c => c.tool === 'get_state').length`);
  await evaluate(`${$('[data-poll]')}.focus()`);
  await key(' ', 'Space', 32);
  assert.equal(await evaluate(`${$('[data-poll]')}.checked`), true);
  await until(() => evaluate(`calls.filter(c => c.tool === 'get_state').length > ${polls}`), 'mock status polling');
  await key(' ', 'Space', 32);
  assert.equal(await evaluate(`${$('[data-poll]')}.checked`), false);
  assert.equal(await evaluate(`calls.filter(c => c.tool === 'get_images').length`), imageCount + 1, 'status poll does not refresh camera');
  await evaluate(`document.querySelector('[data-action="settings"]').click()`);
  assert.equal(await evaluate(`document.querySelector('dialog').matches(':modal')`), true);
  assert.equal((await ax('dialog')).name.value, 'Workbench settings');
  const choose = (key, value) => evaluate(`(() => { const el = document.querySelector('[data-pref="${key}"]'); el.value = '${value}'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await choose('theme', 'dark'); await choose('precision', '2'); await choose('interval', '5000');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.llmd-wb')).colorScheme`), 'dark');
  assert.match(await evaluate(`${$('[data-out="left-pose"]')}.textContent`), /112\.30/);
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('llm-direct-workbench.display.v1'))`), { theme: 'dark', precision: '2', interval: '5000' });
  await evaluate(`document.querySelector('[data-action="defaults"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-pref="precision"]').value`), '1');
  await key('Escape', 'Escape', 27);
  await until(() => evaluate(`!document.querySelector('dialog').open`), 'dismiss settings');
  await evaluate('disposeFixture()');
  console.log('PASS: Chromium accessibility tree, keyboard switches, refresh and mock-only polling');
} finally {
  if (cdp) {
    await Promise.race([cdp.send('Browser.close').catch(() => {}), delay(800)]);
    cdp.close();
  }
  if (browserDone) await Promise.race([browserDone, delay(1000)]);
  if (browser && browser.exitCode === null && browser.signalCode === null) browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
