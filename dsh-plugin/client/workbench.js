const ARMS = ['left', 'right'];
const LANGUAGE_KEY = 'llm-direct-workbench.language';
const COPY = {
  title: ['机器人工作台', 'Robot Workbench'], simulation: ['仅模拟', 'SIMULATION'], refresh: ['刷新', 'Refresh'], poll: ['轮询', 'Poll'],
  language: ['界面语言', 'Interface language'], camera: ['三路相机', 'Three cameras'], top: ['顶部', 'Top'], leftWrist: ['左腕', 'Left wrist'], rightWrist: ['右腕', 'Right wrist'],
  stitched: ['顶部、左腕与右腕相机拼接画面', 'Stitched top, left wrist and right wrist camera feed'], noFrame: ['暂无相机画面', 'No camera frame'],
  left: ['左臂', 'Left arm'], right: ['右臂', 'Right arm'], mode: ['状态', 'Mode'], pose: ['位姿', 'TCP pose'], joints: ['关节°', 'Joints°'], gripper: ['夹爪', 'Grip'], fault: ['故障', 'Fault'],
  controls: ['手动控制', 'Manual controls'], active: ['操作臂', 'Arm'], jogLabel: ['在基座坐标系点动 5 毫米', 'Jog 5 millimeters in the arm base frame'],
  actionLabel: ['夹爪、复位和停止', 'Gripper, reset and stop'], open: ['张开', 'Open'], close: ['闭合', 'Close'], reset: ['复位', 'Reset'], stop: ['停止双臂', 'Stop both'],
  connecting: ['正在连接…', 'Connecting…'], stopping: ['正在停止双臂…', 'Stopping both arms…'], busy: ['动作执行中…', 'Action in progress…'],
  disconnected: ['连接断开', 'Disconnected'], stale: ['状态过期，请刷新', 'Status stale · refresh'], connected: ['模拟已连接', 'Mock connected'],
  auto: ['自动', 'Auto'], dry_run: ['空运行', 'Dry run'], supervised: ['人工确认', 'Supervised'], IDLE: ['空闲', 'Idle'], RUNNING: ['运行中', 'Running'],
  unverified: ['状态未确认', 'Status unverified'], nonMock: ['仅接受模拟后端', 'Mock backend required'], notReady: ['未就绪', 'not ready'], none: ['无', 'None'],
  needMock: ['请先连接模拟后端', 'Connect to a mock backend first'], jogHint: ['基座坐标 · 每次 5 mm', 'Base frame · 5 mm per click'],
  cameraFailed: ['画面刷新失败', 'Camera refresh failed'], previous: ['上一帧', 'Previous frame'], noAction: ['尚未发送动作', 'No action sent'],
  success: ['完成', 'Complete'], refused: ['拒绝或未完成', 'Refused or incomplete'], unknown: ['结果未知，请先刷新', 'Result unknown · refresh first'],
  dryResult: ['未执行（空运行）', 'Not executed (dry run)'], noDetails: ['无详细信息', 'No details returned'],
  stopOk: ['双臂停止已确认', 'Stop acknowledged for both arms'], stopFail: ['停止未确认', 'Stop not confirmed'],
  noState: ['未收到有效的模拟状态', 'No valid mock status returned'], noImage: ['未收到 JPEG 图像', 'No JPEG frame returned'],
  noResult: ['未收到动作结果', 'No action result returned'],
  settings: ['工作台设置', 'Workbench settings'], done: ['完成', 'Done'], defaults: ['恢复默认', 'Reset defaults'],
  theme: ['面板外观', 'Appearance'], system: ['跟随系统', 'System'], light: ['浅色', 'Light'], dark: ['深色', 'Dark'],
  precision: ['读数小数位', 'Telemetry decimals'], interval: ['状态轮询间隔', 'Status poll interval'],
  connection: ['连接目标', 'Connection target'], local: ['本地模拟', 'Local mock'], remote: ['远程', 'Remote'],
  token: ['访问令牌（仅本次）', 'Access token (not saved)'], address: ['远程地址', 'Remote address'], applyConnection: ['应用连接', 'Apply connection'],
  connectionNote: ['新面板从本地模拟开始。点击“应用连接”才会切换当前面板。', 'New panes start on the local mock. Apply to switch this pane only.'],
  targetLabel: ['当前目标', 'Active target'], readOnly: ['远程只读：手动控制和停止均未启用。', 'Remote is read-only. Manual controls and stop are disabled.'],
  manual: ['启用远程手动控制（仅此面板）', 'Enable remote manual control for this pane'], armed: ['手动控制已启用', 'Manual control enabled'],
  manualNote: ['应用地址和令牌并验证状态后才能启用。实机仅限人工确认模式；停止不受模式限制。', 'Apply the address and token, then verify status before enabling. Real motion requires supervised mode; stop works in any mode.'],
  modeBlocked: ['当前模式只可停止。模拟需自动或人工确认模式；实机需人工确认模式。', 'Stop only in this mode. Mock motion requires auto or supervised; real motion requires supervised.'],
  hostMismatch: ['远程目标不匹配；已丢弃响应。请重启 DeepSeek Harness（DSH）以加载新版工作台插件，然后刷新。', 'Remote endpoint mismatch; response discarded. Restart DeepSeek Harness (DSH) to load the updated workbench plugin, then refresh.'],
  cameraPoll: ['轮询时刷新相机快照', 'Include camera snapshots when polling'], snapshotLabel: ['快照（非直播）', 'Snapshot (not live)'], 
  invalidAddress: ['请输入完整的 http(s):// 地址，路径为 /mcp，不含凭据、查询或片段。', 'Enter a full http(s):// address with path /mcp and no credentials, query or fragment.'],
  realConnected: ['实机已连接', 'Real robot connected'], remoteNoState: ['未收到有效的实机或模拟状态', 'No valid real or mock status returned'],
  preferencesNote: ['显示偏好保存在本机。令牌与手动控制开关不会保存。', 'Display preferences are saved on this device. Tokens and manual enable are not saved.'],
  pollNote: ['选中时立即获取快照；开启轮询后按此间隔刷新，非视频流。', 'Select to fetch a snapshot now. With polling on, snapshots refresh at this interval; this is not a video stream.'],
};
const AXES = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
const JOG_MM = 5;
const PREF_KEY = 'llm-direct-workbench.display.v1';
const DEFAULT_PREF = { theme: 'system', precision: '1', interval: '2500' };
const OPTIONS = { theme: ['system', 'light', 'dark'], precision: ['0', '1', '2'], interval: ['1000', '2500', '5000'] };
function normalizePrefs(value) {
  return Object.fromEntries(Object.entries(OPTIONS).map(([key, allowed]) => [key, allowed.includes(value?.[key]) ? value[key] : DEFAULT_PREF[key]]));
}
const CONNECTION_KEY = 'llm-direct-workbench.connection.v1';
function remoteAddress(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\/[^\s/@?#\\]+\/mcp$/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.pathname === '/mcp' ? url.href : null;
  } catch { return null; }
}
const STALE_MS = 8000;
const mounted = new WeakMap();

function armMarkup(arm) {
  return `<section class="llmd-wb__card llmd-wb__arm" data-label="${arm}">
    <h3 data-i18n="${arm}"></h3>
    <dl class="llmd-wb__metrics">
      <dt data-i18n="mode"></dt><dd data-out="${arm}-mode">—</dd>
      <dt data-i18n="pose"></dt><dd data-out="${arm}-pose">—</dd>
      <dt data-i18n="joints"></dt><dd data-out="${arm}-joints">—</dd>
      <dt data-i18n="gripper"></dt><dd data-out="${arm}-gripper">—</dd>
      <dt data-i18n="fault"></dt><dd data-out="${arm}-fault">—</dd>
    </dl>
  </section>`;
}

function number(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function errorText(error) {
  return error?.message || String(error);
}

function resultReason(data) {
  if (data?.reason || data?.status) return data.reason || data.status;
  return Object.entries(data?.arms ?? {})
    .filter(([, result]) => result?.ok === false || (typeof result === 'string' && result !== 'stopped'))
    .map(([arm, result]) => `${arm}: ${result?.reason ?? result?.status ?? result}`)
    .join('; ');
}

/** Mount an independently targeted panel and return its idempotent disposer. */
export function mountWorkbench(root, call) {
  mounted.get(root)?.();
  const panel = root.ownerDocument.createElement('section');
  panel.className = 'llmd-wb';
  panel.dataset.label = 'title';
  panel.innerHTML = `
    <header class="llmd-wb__bar llmd-wb__head">
      <div class="llmd-wb__brand"><h2 data-i18n="title"></h2><span class="llmd-wb__eyebrow" data-out="target"></span></div>
      <div class="llmd-wb__buttons">
        <button type="button" data-action="refresh" data-i18n="refresh"></button>
        <label class="llmd-wb__poll"><input type="checkbox" data-poll><span data-i18n="poll"></span></label>
        <select data-language data-label="language"><option value="zh" lang="zh-CN">中文</option><option value="en" lang="en">EN</option></select>
      </div>
    </header>
    <div class="llmd-wb__rail"><p class="llmd-wb__status" role="status" data-out="status"></p><button class="llmd-wb__settings-trigger" type="button" data-action="settings" data-label="settings" aria-haspopup="dialog"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2.5"/><circle cx="9" cy="17" r="2.5"/></svg></button></div>
    <dialog class="llmd-wb__prefs" data-label="settings">
      <h3 data-i18n="settings"></h3><p class="llmd-wb__hint" data-i18n="preferencesNote"></p>
      <fieldset class="llmd-wb__connection"><legend data-i18n="connection"></legend>
        <p class="llmd-wb__hint" data-out="active-target"></p>
        <label><span data-i18n="connection"></span><select data-connection-mode><option value="local" data-i18n="local"></option><option value="remote" data-i18n="remote"></option></select></label>
        <label><span data-i18n="address"></span><input type="url" data-endpoint placeholder="http://192.168.1.50:8765/mcp" autocomplete="off" spellcheck="false"></label>
        <label><span data-i18n="token"></span><input type="password" data-token maxlength="1024" autocomplete="off" spellcheck="false"></label>
        <p class="llmd-wb__hint" data-i18n="connectionNote"></p>
        <label><span data-i18n="manual"></span><input type="checkbox" data-manual></label>
        <p class="llmd-wb__hint" data-i18n="manualNote"></p>
        <p role="status" data-kind="error" data-out="address-error"></p>
        <button type="button" data-action="apply-connection" data-i18n="applyConnection"></button>
      </fieldset>
      <label><span data-i18n="theme"></span><select data-pref="theme">${OPTIONS.theme.map(v => `<option value="${v}" data-i18n="${v}"></option>`).join('')}</select></label>
      <label><span data-i18n="precision"></span><select data-pref="precision">${OPTIONS.precision.map(v => `<option>${v}</option>`).join('')}</select></label>
      <label><span data-i18n="interval"></span><select data-pref="interval">${OPTIONS.interval.map(v => `<option value="${v}">${Number(v)/1000} s</option>`).join('')}</select></label>
      <label><span data-i18n="cameraPoll"></span><input type="checkbox" data-camera-poll></label>
      <p class="llmd-wb__hint" data-i18n="pollNote"></p>
      <footer><button type="button" data-action="defaults" data-i18n="defaults"></button><button type="button" data-action="done" data-i18n="done"></button></footer>
    </dialog>
    <div class="llmd-wb__layout">
      <section class="llmd-wb__camera llmd-wb__card" data-label="camera">
        <h3 data-i18n="camera"></h3>
        <div class="llmd-wb__viewport">
          <span data-out="image-placeholder" data-i18n="noFrame"></span>
          <img data-frame draggable="false" hidden>
        </div>
        <div class="llmd-wb__legend"><span data-i18n="top"></span><span data-i18n="leftWrist"></span><span data-i18n="rightWrist"></span></div>
        <p class="llmd-wb__hint" data-out="camera"></p>
      </section>
      <div class="llmd-wb__stack">${ARMS.map(armMarkup).join('')}</div>
    </div>
    <section class="llmd-wb__card llmd-wb__controls" data-label="controls">
      <div class="llmd-wb__bar">
        <h3 data-i18n="controls"></h3>
        <label><span data-i18n="active"></span> <select data-arm><option value="left" data-i18n="left"></option><option value="right" data-i18n="right"></option></select></label>
      </div>
      <p class="llmd-wb__hint" data-out="motion-hint"></p>
      <div class="llmd-wb__buttons llmd-wb__jog" role="group" data-label="jogLabel">
        ${AXES.slice(0, 3).flatMap(axis => [-1, 1].map(sign => `<button type="button" data-action="jog" data-move data-axis="${axis}" data-sign="${sign}">${axis.toUpperCase()}${sign < 0 ? '−' : '+'}</button>`)).join('')}
      </div>
      <div class="llmd-wb__buttons llmd-wb__actions" role="group" data-label="actionLabel">
        <button type="button" data-action="open" data-move data-i18n="open"></button>
        <button type="button" data-action="close" data-move data-i18n="close"></button>
        <button type="button" data-action="reset" data-move data-i18n="reset"></button>
        <button type="button" class="llmd-wb__stop" data-action="stop" data-i18n="stop"></button>
      </div>
      <p class="llmd-wb__feedback" role="status" data-out="feedback"></p>
    </section>`;
  root.append(panel);

  const outputs = Object.fromEntries(Array.from(panel.querySelectorAll('[data-out]'), el => [el.dataset.out, el]));
  const frame = panel.querySelector('[data-frame]');
  const languageSelect = panel.querySelector('[data-language]');
  const armSelect = panel.querySelector('[data-arm]');
  const polling = panel.querySelector('[data-poll]');
  const refreshButton = panel.querySelector('[data-action="refresh"]');
  const stopButton = panel.querySelector('[data-action="stop"]');
  const moveButtons = panel.querySelectorAll('[data-move]');
  const clock = root.ownerDocument.defaultView ?? globalThis;
  const dialog = panel.querySelector('dialog');
  const settingsButton = panel.querySelector('[data-action="settings"]');
  const prefInputs = [...dialog.querySelectorAll('[data-pref]')];
  const modeInput = dialog.querySelector('[data-connection-mode]');
  const addressInput = dialog.querySelector('[data-endpoint]');
  const tokenInput = dialog.querySelector('[data-token]');
  let activeToken = ''; // Memory only and bound to this pane's applied endpoint.
  const applyButton = dialog.querySelector('[data-action="apply-connection"]');
  let endpoint = null; // Per pane. Saved values prefill the editor; only Apply changes this target.
  let addressError = false;
  let savedAddress = '';
  try {
    const saved = JSON.parse(clock.localStorage.getItem(CONNECTION_KEY));
    savedAddress = remoteAddress(saved?.address) || '';
    modeInput.value = saved?.mode === 'remote' ? 'remote' : 'local';
  } catch { /* storage unavailable */ }
  addressInput.value = savedAddress;
  let prefs = { ...DEFAULT_PREF };
  try { prefs = normalizePrefs(JSON.parse(clock.localStorage.getItem(PREF_KEY))); } catch { /* unavailable or corrupt */ }
  let language = 'zh';
  try { if (clock.localStorage.getItem(LANGUAGE_KEY) === 'en') language = 'en'; } catch { /* storage unavailable */ }
  const t = (key) => Object.hasOwn(COPY, key) ? COPY[key][language === 'en' ? 1 : 0] : key;
  const localized = panel.querySelectorAll('[data-i18n]');
  const labels = [panel, ...panel.querySelectorAll('[data-label]')];
  let actionFeedback = ['noAction', '', ''];
  let connectionDetail = [];
  let cameraDetail = '';
  function applyLanguage() {
    panel.lang = language === 'zh' ? 'zh-CN' : 'en';
    languageSelect.value = language;
    for (const el of localized) el.textContent = t(el.dataset.i18n);
    for (const el of labels) el.setAttribute('aria-label', t(el.dataset.label));
    settingsButton.title = t('settings');
    frame.alt = t('stitched');
    render();
  }
  let disposed = false;
  let generation = 0;
  let observation = null;
  let motion = null;
  let stopping = null;
  let readAfterStop = false;
  const manualInput = dialog.querySelector('[data-manual]');
  const cameraPoll = dialog.querySelector('[data-camera-poll]');
  let verified = false;
  let armed = false;
  let unknownOutcome = false;
  let frameAt = null;
  let snapshot = null;
  let sampleAt = null;
  const text = (key, detail = '') => detail ? `${t(key)} · ${detail}` : t(key);
  const detailText = (detail) => detail ? (detail instanceof Error ? errorText(detail) : t(detail)) : '';
  let statusTimer;
  let pollTimer;

  function applyPrefs(save = false) {
    panel.dataset.theme = prefs.theme;
    for (const input of prefInputs) input.value = prefs[input.dataset.pref];
    if (save) { try { clock.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } }
  }

  function schedulePoll() {
    clock.clearInterval(pollTimer);
    if (polling.checked) pollTimer = clock.setInterval(() => void refresh(false), Number(prefs.interval));
  }

  function output(key, value) {
    if (outputs[key].textContent !== value) outputs[key].textContent = value;
  }

  function feedback(key, kind = '', detail = '') {
    actionFeedback = [key, kind, detail];
    renderFeedback();
  }

  function renderFeedback() {
    const [key, kind, detail] = actionFeedback;
    outputs.feedback.dataset.kind = kind;
    output('feedback', text(key, typeof detail === 'function' ? detail() : detail));
  }

  function isCurrent(token) {
    return !disposed && token === generation;
  }

  function invalidateObservation() {
    generation++;
    observation = null;
    return generation;
  }

  function isStale() {
    return sampleAt === null || clock.performance.now() - sampleAt >= STALE_MS;
  }

  // Every remote payload, including a command acknowledgement or embedded frame,
  // must identify its destination. Older hosts silently serve the local simulator.
  async function request(token, tool, args, command = false) {
    const target = endpoint;
    const manual = command && target !== null && verified && armed && Boolean(activeToken);
    if (command && target !== null && !manual) throw new Error('readOnly');
    const body = await call(tool, args, target, activeToken, manual || undefined);
    if (target !== null && body?.endpoint !== target) {
      if (isCurrent(token)) {
        verified = armed = false;
        snapshot = sampleAt = frameAt = null;
        frame.removeAttribute('src');
        frame.hidden = true;
        outputs['image-placeholder'].hidden = false;
        cameraDetail = '';
        connectionDetail = ['hostMismatch'];
      }
      throw new Error('hostMismatch');
    }
    return body;
  }

  function canArm() {
    return endpoint !== null && verified && Boolean(activeToken) && !isStale() && !connectionDetail.length &&
      modeInput.value === 'remote' && remoteAddress(addressInput.value) === endpoint && !tokenInput.value && !unknownOutcome;
  }

  function canStop() {
    return !stopping && verified && (endpoint === null || (armed && Boolean(activeToken)));
  }

  function moveBlock(arm) {
    if (endpoint !== null && !armed) return t('readOnly');
    if (stopping) return t('stopping');
    if (motion) return t('busy');
    if (unknownOutcome) return t('unknown');
    if (!verified || connectionDetail.length || !snapshot) return t(endpoint === null ? 'needMock' : 'unverified');
    if (isStale()) return t('stale');
    if (endpoint !== null && !(snapshot.mode === 'supervised' || (snapshot.mock && snapshot.mode === 'auto'))) return t('modeBlocked');
    const state = snapshot.arms[arm];
    if (state?.fault || state?.error) return `${t(arm)}: ${state.fault || state.error}`;
    if (!state?.tcp_pose || state.moving !== false) return `${t(arm)} · ${t('notReady')}`;
    return '';
  }

  function render() {
    const busy = Boolean(motion || stopping);
    manualInput.checked = armed;
    manualInput.disabled = busy || (!armed && !canArm());
    const target = endpoint === null ? t('local') : `${t('remote')} · ${endpoint}${armed ? ` · ${t('armed')}` : ''}`;
    output('target', target);
    output('active-target', `${t('targetLabel')}: ${target}`);
    output('address-error', addressError ? t('invalidAddress') : '');
    applyButton.disabled = busy;
    modeInput.disabled = busy;
    addressInput.disabled = tokenInput.disabled = busy || modeInput.value !== 'remote';
    let status = t('connecting');
    let kind = '';
    if (connectionDetail.length) {
      status = text(connectionDetail[0], detailText(connectionDetail[1]));
      kind = 'error';
    } else if (busy) {
      status = t(stopping ? 'stopping' : 'busy');
    } else if (snapshot && isStale()) {
      status = t('stale');
      kind = 'error';
    } else if (snapshot) {
      status = text(snapshot.mock ? 'connected' : 'realConnected', detailText(snapshot.mode));
      kind = 'ok';
    }
    outputs.status.dataset.kind = kind;
    output('status', status);
    const oldFrame = !frame.hidden && (cameraDetail || connectionDetail.length || clock.performance.now() - frameAt >= STALE_MS);
    frame.title = t('snapshotLabel');
    output('camera', [cameraDetail ? text('cameraFailed', detailText(cameraDetail)) : '', oldFrame ? t('previous') : ''].filter(Boolean).join(' · '));
    renderFeedback();
    for (const arm of ARMS) {
      const state = snapshot?.arms[arm];
      output(`${arm}-mode`, state?.robot_mode ? t(state.robot_mode) : '—');
      output(`${arm}-pose`, state?.tcp_pose ? AXES.map(key => `${key.toUpperCase()} ${number(state.tcp_pose[key], Number(prefs.precision))}`).join(' · ') : '—');
      output(`${arm}-joints`, Array.isArray(state?.joints_deg) && state.joints_deg.length ? state.joints_deg.map(joint => number(joint, Number(prefs.precision))).join(' · ') : '—');
      output(`${arm}-gripper`, Number.isFinite(state?.gripper_opening) ? `${number(state.gripper_opening * 100, 0)}%` : state?.gripper_error || '—');
      output(`${arm}-fault`, state?.fault || state?.error || (state ? t('none') : '—'));
    }
    const reason = moveBlock(armSelect.value);
    for (const button of moveButtons) button.disabled = Boolean(reason);
    output('motion-hint', reason || t('jogHint'));
    refreshButton.disabled = busy || observation?.full === true;
    // Stop remains available during motion, stale telemetry or an unknown outcome.
    stopButton.disabled = !canStop();
  }

  function showFrame(image) {
    if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(image)) return false;
    if (frame.getAttribute('src') !== image) frame.setAttribute('src', image);
    frame.hidden = false;
    outputs['image-placeholder'].hidden = true;
    cameraDetail = '';
    return true;
  }

  async function refresh(full) {
    if (disposed || motion || stopping || (!full && observation) || observation?.full) return;
    const token = invalidateObservation();
    observation = { full };
    const startedAt = clock.performance.now();
    render();
    try {
      const { data } = await call('get_state', { arm: 'both' }, endpoint, activeToken);
      if (!isCurrent(token)) return;
      if (endpoint === null && data?.mock === false) {
        mockVerified = false;
        snapshot = null;
        frame.removeAttribute('src');
        frame.hidden = true;
        outputs['image-placeholder'].hidden = false;
        cameraDetail = '';
        connectionDetail = ['nonMock'];
        return;
      }
      if (data?.ok !== true || typeof data.mock !== 'boolean' || !data.arms?.left || !data.arms?.right) {
        throw new Error(data?.reason || (endpoint === null ? 'noState' : 'remoteNoState'));
      }
      mockVerified = endpoint === null && data.mock;
      snapshot = data;
      sampleAt = startedAt;
      connectionDetail = [];
      render();
      if (full) {
        try {
          const { image } = await call('get_images', { grid: false }, endpoint, activeToken);
          if (isCurrent(token) && !showFrame(image)) throw new Error('noImage');
        } catch (error) {
          if (isCurrent(token)) cameraDetail = errorText(error);
        }
      }
    } catch (error) {
      if (isCurrent(token)) {
        connectionDetail = ['disconnected', errorText(error)];
        sampleAt = null;
      }
    } finally {
      if (isCurrent(token)) {
        observation = null;
        render();
      }
    }
  }

  function refreshAfterStop() {
    if (!readAfterStop || disposed || motion || stopping) return;
    readAfterStop = false;
    void refresh(true);
  }

  async function sendMotion(tool, args, label) {
    if (disposed || moveBlock(args.arm)) return;
    const token = invalidateObservation();
    motion = token;
    sampleAt = null;
    let observeAfter = false;
    let needsImage = true;
    feedback('busy', '', label);
    render();
    try {
      const { data, image } = await call(tool, args, endpoint);
      if (!isCurrent(token)) return;
      if (data?.ok === true) {
        const outcome = data.dry_run || data.arms?.[args.arm]?.dry_run ? 'dryResult' : 'success';
        feedback(outcome, 'ok', label);
        needsImage = !showFrame(image);
      } else if (data?.ok === false) {
        feedback('refused', 'error', () => `${label()} · ${resultReason(data) || t('noDetails')}`);
      } else {
        throw new Error('noResult');
      }
      observeAfter = true;
    } catch (error) {
      if (isCurrent(token)) {
        connectionDetail = ['unverified', errorText(error)];
        feedback('unknown', 'error', label);
      }
    } finally {
      if (motion === token) motion = null;
      if (!disposed) {
        render();
        if (isCurrent(token) && observeAfter) void refresh(needsImage);
        else refreshAfterStop();
      }
    }
  }

  async function stop() {
    if (disposed || endpoint !== null || stopping || !mockVerified) return;
    const token = invalidateObservation();
    stopping = token;
    sampleAt = null;
    readAfterStop = false;
    feedback('stopping');
    render();
    try {
      const { data } = await call('stop', { arm: 'both' }, endpoint);
      if (!isCurrent(token)) return;
      if (data?.ok === true) feedback('stopOk', 'ok');
      else if (data?.ok === false) feedback('stopFail', 'error', () => resultReason(data) || t('noDetails'));
      else throw new Error('noResult');
      readAfterStop = true;
    } catch (error) {
      if (isCurrent(token)) {
        connectionDetail = ['unverified', errorText(error)];
        feedback('unknown', 'error', () => t('stop'));
      }
    } finally {
      if (stopping === token) stopping = null;
      if (!disposed) {
        render();
        refreshAfterStop();
      }
    }
  }

  function applyConnection() {
    if (disposed || motion || stopping) return;
    const remote = modeInput.value === 'remote';
    const next = remote ? remoteAddress(addressInput.value) : null;
    addressError = remote && !next;
    if (addressError) { render(); addressInput.focus(); return; }
    if (remote) savedAddress = next;
    addressInput.value = savedAddress;
    try { clock.localStorage.setItem(CONNECTION_KEY, JSON.stringify({ mode: modeInput.value, address: savedAddress })); } catch { /* storage unavailable */ }
    // Reuse the active secret only for the identical endpoint, never for a changed host.
    activeToken = remote ? (tokenInput.value.trim() || (next === endpoint ? activeToken : '')) : '';
    tokenInput.value = '';
    invalidateObservation();
    endpoint = next;
    mockVerified = false;
    snapshot = sampleAt = null;
    frame.removeAttribute('src');
    frame.hidden = true;
    outputs['image-placeholder'].hidden = false;
    cameraDetail = '';
    connectionDetail = [];
    actionFeedback = ['noAction', '', ''];
    void refresh(true);
  }

  function onClick(event) {
    const button = event.target.closest?.('button');
    if (!button || !panel.contains(button) || button.disabled) return;
    const arm = armSelect.value;
    switch (button.dataset.action) {
      case 'apply-connection': applyConnection(); break;
      case 'settings': dialog.showModal(); break;
      case 'done': dialog.close(); break;
      case 'defaults': prefs = { ...DEFAULT_PREF }; applyPrefs(true); schedulePoll(); render(); break;
      case 'refresh': void refresh(true); break;
      case 'jog': {
        const { axis, sign } = button.dataset;
        const delta = JOG_MM * Number(sign);
        void sendMotion('move_relative', { arm, [`d${axis}`]: delta, with_image: true }, () => `${t(arm)} ${axis.toUpperCase()} ${delta > 0 ? '+' : '−'}${JOG_MM} mm`);
        break;
      }
      case 'open': void sendMotion('gripper', { arm, opening: 1, with_image: true }, () => `${t(arm)} · ${t('open')}`); break;
      case 'close': void sendMotion('gripper', { arm, opening: 0, with_image: true }, () => `${t(arm)} · ${t('close')}`); break;
      case 'reset': void sendMotion('move_to_named', { arm, pose: 'reset', with_image: true }, () => `${t(arm)} · ${t('reset')}`); break;
      case 'stop': void stop(); break;
    }
  }

  function onChange(event) {
    if (event.target === modeInput || event.target === addressInput) { addressError = false; render(); }
    if (event.target === languageSelect) {
      language = languageSelect.value === 'en' ? 'en' : 'zh';
      try { clock.localStorage.setItem(LANGUAGE_KEY, language); } catch { /* storage unavailable */ }
      applyLanguage();
    }
    if (event.target === armSelect) render();
    if (prefInputs.includes(event.target)) {
      const key = event.target.dataset.pref;
      prefs = normalizePrefs({ ...prefs, [key]: event.target.value });
      applyPrefs(true);
      if (key === 'interval') schedulePoll();
      render();
    }
    if (event.target === polling) {
      schedulePoll();
      if (polling.checked) void refresh(false);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    invalidateObservation();
    clock.clearInterval(statusTimer);
    clock.clearInterval(pollTimer);
    panel.removeEventListener('click', onClick);
    panel.removeEventListener('change', onChange);
    panel.remove();
    if (mounted.get(root) === dispose) mounted.delete(root);
  }

  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  mounted.set(root, dispose);
  applyPrefs();
  applyLanguage();
  statusTimer = clock.setInterval(render, 500);
  void refresh(true);
  return dispose;
}
