import http from 'node:http';
import https from 'node:https';
import { isIPv4 } from 'node:net';

// MCP Python SDK 2.x supports both a newer, stateless wire format and this
// 2025 initialize/session handshake. Don't mix versions mid-session.
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const accept = 'application/json, text/event-stream';
const maxBytes = 4 * 1024 * 1024;

function destination(endpoint) {
  // Validate the literal path/authority before URL can normalize away userinfo,
  // dot segments, encoded host characters, backslashes, or empty queries.
  const invalid = () => new Error('请输入明确的 HTTP(S) /mcp 地址（无凭据、查询或片段）');
  if (typeof endpoint !== 'string' || endpoint.length > 512 || /\s/.test(endpoint)) throw invalid();
  const match = /^https?:\/\/(\[::1\]|[a-z\d.-]+)(?::(\d{1,5}))?\/mcp$/i.exec(endpoint);
  if (!match) throw invalid();
  const url = new URL(endpoint);
  const host = match[1].toLowerCase();
  if (host !== url.hostname || url.port === '0') throw invalid(); // no abbreviated/octal IPv4
  if (isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    if (!(a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) throw invalid();
  } else if (host !== '[::1]' && (host.length > 253 || host.split('.').some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)))) throw invalid();
  return url;
}

function readArgs(tool, args) {
  if (tool !== 'get_state' && tool !== 'get_images') throw new Error('远程连接仅允许读取状态或图像');
  const field = tool === 'get_state' ? 'arm' : 'grid';
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => k !== field)) throw new Error('无效的远程读取参数');
  if (!Object.hasOwn(args, field)) return {};
  const value = args[field];
  if (field === 'arm' ? !['both', 'left', 'right'].includes(value) : typeof value !== 'boolean') throw new Error('无效的远程读取参数');
  return { [field]: value };
}

// Native request only: no ambient browser cookies, DSH headers, redirect
// following, automatic decompression, or connection reuse across calls.
function request(url, method, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request(url, { method, headers, agent: false, signal }, resolve);
    req.once('error', reject);
    req.end(body);
  });
}

async function* boundedChunks(response, limit) {
  let size = 0;
  if (Number(response.headers['content-length']) > limit) throw new Error('远程响应过大');
  for await (const chunk of response) {
    size += chunk.length;
    if (size > limit) throw new Error('远程响应过大');
    yield chunk;
  }
}

function rpcResult(message, id) {
  if (message?.jsonrpc !== '2.0' || message.id !== id || message.method) throw new Error('远程 MCP 响应不匹配');
  if (message.error || !message.result || typeof message.result !== 'object') throw new Error('远程 MCP 请求失败');
  return message.result;
}

async function readResult(response, id, limit) {
  const type = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
  const chunks = boundedChunks(response, limit);
  if (type === 'application/json') {
    const parts = [];
    for await (const chunk of chunks) parts.push(chunk);
    return rpcResult(JSON.parse(Buffer.concat(parts).toString('utf8')), id);
  }
  if (type !== 'text/event-stream') throw new Error('远程 MCP 响应格式不受支持');

  // SSE records may span chunks and the connection may stay open after our
  // response. Consume complete events, ignoring heartbeats and notifications.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = [], data = [], event = '', afterCR = false, lines = 0;
  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (afterCR) { afterCR = false; if (c === '\n') { start = i + 1; continue; } }
      if (c !== '\r' && c !== '\n') continue;
      afterCR = c === '\r';
      if (++lines > 16384) throw new Error('远程 SSE 响应行数过多');
      line.push(text.slice(start, i));
      const field = line.join('');
      line = []; start = i + 1;
      if (!field) {
        const payload = data.join('\n');
        if ((!event || event === 'message') && payload.trim()) {
          const message = JSON.parse(payload);
          if (message?.id === id) return rpcResult(message, id);
        }
        event = ''; data = [];
      } else if (field === 'data' || field.startsWith('data:')) data.push(field.slice(5).replace(/^ /, ''));
      else if (field.startsWith('event:')) event = field.slice(6).replace(/^ /, '');
    }
    if (start < text.length) line.push(text.slice(start));
  }
  throw new Error('远程 SSE 流未返回对应结果');
}

const reads = new Set(['get_state', 'get_images']);
const commands = new Set(['move_relative', 'gripper', 'move_to_named', 'stop']);
export const isRemoteRead = tool => reads.has(tool);
export const isRemoteCommand = tool => commands.has(tool);
const invalidArgs = () => Object.assign(new Error('Invalid manual command arguments'), { status: 400 });

function commandArgs(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidArgs();
  const keys = Object.keys(args);
  if (tool === 'stop') {
    if (keys.length !== 1 || args.arm !== 'both') throw invalidArgs();
    return { arm: 'both' };
  }
  if (!['left', 'right'].includes(args.arm) || ('with_image' in args && typeof args.with_image !== 'boolean')) throw invalidArgs();
  const fields = keys.filter(k => k !== 'arm' && k !== 'with_image');
  if (fields.length !== 1) throw invalidArgs();
  const k = fields[0], v = args[k];
  if (!(tool === 'move_relative' && ['dx', 'dy', 'dz'].includes(k) && [-5, 5].includes(v)) &&
      !(tool === 'gripper' && k === 'opening' && [0, 1].includes(v)) &&
      !(tool === 'move_to_named' && k === 'pose' && v === 'reset')) throw invalidArgs();
  return { arm: args.arm, [k]: v, with_image: args.with_image ?? true };
}

function jsonData(raw) {
  const text = raw.content.find(b => b?.type === 'text')?.text;
  let data;
  try { data = JSON.parse(text); } catch { /* Don't expose arbitrary remote text in parse errors. */ }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid MCP tool data');
  return data;
}
function verifiedState(raw, arm = 'both') {
  const data = jsonData(raw);
  const names = arm === 'both' ? ['left', 'right'] : [arm];
  if (data.ok !== true || typeof data.mock !== 'boolean' || !['auto', 'dry_run', 'supervised'].includes(data.mode) ||
      !names.every(n => data.arms?.[n]?.arm === n)) throw new Error('Unverified LLM-Direct state');
  return data;
}
function imageResult(raw) {
  const b = raw.content.find(b => b?.type === 'image' && b.mimeType === 'image/jpeg');
  if (typeof b?.data !== 'string' || !b.data.startsWith('/9j/') || b.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)) throw new Error('Invalid remote JPEG');
  return `data:image/jpeg;base64,${b.data}`;
}

// Reject rather than queue. Reserve stop capacity separately from reads/motion.
let readers = 0, moving = false, stopping = false, stopEpoch = 0;
export async function remoteCall(endpoint, tool, args, signal, token, manual) {
  if (token !== undefined && (typeof token !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(token))) throw new Error('Invalid remote token');
  const url = destination(endpoint);
  const reading = reads.has(tool), stop = tool === 'stop';
  if (!reading && (!commands.has(tool) || manual !== true || !token)) throw Object.assign(new Error('Explicit manual command and bearer token required'), { status: 403 });
  const parameters = reading ? readArgs(tool, args) : commandArgs(tool, args);
  const deadline = AbortSignal.timeout(reading || stop ? 12000 : 90000);
  const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let session, version;
  const headers = () => ({ accept, ...(token && { authorization: `Bearer ${token}` }), ...(session && { 'mcp-session-id': session }), ...(version && { 'mcp-protocol-version': version }) });
  async function post(method, params, id) {
    const res = await request(url, 'POST', { ...headers(), 'content-type': 'application/json' }, JSON.stringify({ jsonrpc: '2.0', method, params, id }), active);
    try {
      if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`远程 MCP HTTP ${res.statusCode}`);
      if (method === 'initialize' && res.headers['mcp-session-id'] !== undefined) {
        const issued = res.headers['mcp-session-id'];
        if (typeof issued !== 'string' || !/^[!-~]{1,512}$/.test(issued)) throw new Error('远程 MCP 会话 ID 无效');
        session = issued;
      }
      if (id === undefined) return;
      return await readResult(res, id, method === 'initialize' ? 256 * 1024 : maxBytes);
    } finally { res.destroy(); }
  }
  async function invoke(name, parameters, id) {
    const raw = await post('tools/call', { name, arguments: parameters }, id);
    if (raw.isError || !Array.isArray(raw.content)) throw new Error('Remote MCP tool failed');
    return raw;
  }
  if (reading ? readers >= 4 : stop ? stopping : moving || stopping) throw Object.assign(new Error('Remote request busy; not queued'), { status: 409 });
  if (reading) readers++; else if (stop) { stopping = true; stopEpoch++; } else moving = true;
  const epoch = stopEpoch;
  try {
    const init = await post('initialize', { protocolVersion: versions[0], capabilities: {}, clientInfo: { name: 'dsh-workbench', version: '1.0' } }, 1);
    if (init.serverInfo?.name !== 'llm-direct') throw new Error('Not an LLM-Direct server');
    if (!versions.includes(init.protocolVersion)) throw new Error('远程 MCP 协议版本不受支持');
    version = init.protocolVersion;
    await post('notifications/initialized');
    if (!reading && !session) throw new Error('Manual commands require a stateful MCP session');
    const stateArgs = tool === 'get_state' ? parameters : { arm: 'both' };
    const state = verifiedState(await invoke('get_state', stateArgs, 2), stateArgs.arm);
    if (tool === 'get_state') return { endpoint, data: state };
    if (tool === 'get_images') return { endpoint, image: imageResult(await invoke(tool, parameters, 3)) };
    if (!(state.mode === 'supervised' || state.mode === 'auto' || (!state.mock && stop))) {
      throw Object.assign(new Error('Manual command not allowed in this target mode'), { status: 403 });
    }
    if (!stop && epoch !== stopEpoch) throw Object.assign(new Error('Cancelled by stop before dispatch'), { status: 409 });
    // Only one dispatch. After dispatch any failure leaves the outcome unknown.
    try {
      const raw = await invoke(tool, parameters, 3), data = jsonData(raw);
      if (typeof data.ok !== 'boolean') throw new Error('Invalid command result');
      return { endpoint, data, ...(raw.content.some(b => b?.type === 'image') && { image: imageResult(raw) }) };
    } catch { throw new Error('Remote command outcome unknown; not retried. Inspect target state.'); }
  } finally {
    // A caller abort must not strand a session or turn cleanup into an
    // unbounded wait. Terminate the transport only; never issue robot stop.
    if (session) {
      try { (await request(url, 'DELETE', headers(), undefined, AbortSignal.timeout(1500))).destroy(); }
      catch { /* Best effort: a disconnected server may not be reachable. */ }
    }
    if (reading) readers--; else if (stop) stopping = false; else moving = false;
  }
}

export const remoteRead = (endpoint, tool, args, signal, token) => remoteCall(endpoint, tool, args, signal, token);
