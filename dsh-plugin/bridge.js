import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const names = new Set(['get_state', 'get_images', 'move_relative', 'gripper', 'move_to_named', 'stop']);
const motions = new Set(['move_relative', 'gripper', 'move_to_named']);

export function createBridge(projectDir, python = join(projectDir, '.venv', 'Scripts', 'python.exe')) {
  let active, closed = false, busy = false, nextId = 0;

  function detach(worker, reason) {
    if (active === worker) active = undefined;
    worker.lines.close();
    if (worker.child.exitCode === null) worker.child.kill();
    for (const job of worker.pending.values()) job.finish(new Error(reason));
    worker.pending.clear();
  }

  function start() {
    if (closed) throw new Error('模拟服务已关闭');
    if (active) return active;
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|PASSWORD|SECRET|TOKEN|^DSH_|^PYTHON/i.test(k)));
    const child = spawn(python, ['-m', 'llm_direct.server', '--mock', '--mode', 'auto', '--transport', 'stdio'], {
      cwd: projectDir, env: { ...env, PYTHONUTF8: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const worker = active = { child, lines, pending: new Map() };
    child.stderr.resume();
    child.once('error', (e) => detach(worker, `模拟服务启动失败 (${e.code ?? 'spawn'})`));
    child.once('exit', (code) => detach(worker, `模拟服务已退出 (${code ?? 'signal'})；请检查 Python 依赖`));
    child.stdin.on('error', () => detach(worker, '模拟服务输入已关闭'));
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { detach(worker, '模拟服务返回了无效的 MCP 消息'); return; }
      const job = worker.pending.get(message.id);
      if (job) job.finish(message.error ? new Error(String(message.error.message ?? 'MCP error')) : null, message.result);
    });
    worker.ready = (async () => {
      await request(worker, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-llm-direct-workbench', version: '0.1.0' } });
      if (active !== worker) throw new Error('模拟服务已断开');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    })();
    return worker;
  }

  function request(worker, method, params) {
    return new Promise((resolve, reject) => {
      if (active !== worker) { reject(new Error('模拟服务已断开')); return; }
      const id = ++nextId;
      const timer = setTimeout(() => {
        // A timed-out action has unknown outcome. Reset transport, never replay.
        detach(worker, '模拟服务超时；动作未重发，请刷新状态');
      }, method === 'initialize' ? 10_000 : 38_000);
      worker.pending.set(id, { finish(error, result) {
        clearTimeout(timer);
        worker.pending.delete(id);
        if (error) reject(error); else resolve(result);
      } });
      worker.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  return {
    async call(tool, args) {
      if (!names.has(tool) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('不支持的工具或参数');
      const motion = motions.has(tool);
      if (motion && busy) return { data: { ok: false, reason: '已有模拟动作在执行' } };
      if (motion) busy = true;
      try {
        const worker = start();
        await worker.ready;
        const raw = await request(worker, 'tools/call', { name: tool, arguments: args });
        if (raw?.isError) throw new Error(raw.content?.find(b => b.type === 'text')?.text ?? 'MCP 工具调用失败');
        const result = {};
        for (const block of raw?.content ?? []) {
          if (block.type === 'text') result.data = JSON.parse(block.text);
          if (block.type === 'image' && block.mimeType === 'image/jpeg' && /^[A-Za-z0-9+/]+=*$/.test(block.data)) result.image = `data:image/jpeg;base64,${block.data}`;
        }
        if (!result.data && !result.image) throw new Error('MCP 未返回状态或图像');
        if (tool === 'get_state' && result.data?.mock !== true) {
          detach(worker, '拒绝连接非模拟后端');
          throw new Error('拒绝连接非模拟后端');
        }
        return result;
      } finally { if (motion) busy = false; }
    },
    close() { closed = true; if (active) detach(active, '模拟服务已关闭'); },
  };
}
