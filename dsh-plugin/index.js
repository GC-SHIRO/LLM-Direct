import { isAbsolute } from 'node:path';
import { createBridge } from './bridge.js';

export const inject = ['connection'];
const path = '/api/llm-direct-workbench/call';
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

export function apply(ctx, config) {
  if (typeof config?.projectDir !== 'string' || !isAbsolute(config.projectDir)) throw new Error('LLM-Direct: projectDir must be absolute');
  if (config.python !== undefined && (typeof config.python !== 'string' || !isAbsolute(config.python))) throw new Error('LLM-Direct: python must be absolute');
  const bridge = createBridge(config.projectDir, config.python);
  ctx.effect(() => () => bridge.close(), 'llm-direct: mock process');
  ctx.connection.fetch.register({
    path, methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ error: 'Expected application/json' }, 415);
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'Missing request body' }, 400);
      const decoder = new TextDecoder();
      let size = 0, text = '', input;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) { void reader.cancel().catch(() => {}); return reply({ error: 'Request too large' }, 413); }
          text += decoder.decode(value, { stream: true });
        }
        input = JSON.parse(text + decoder.decode());
      } catch { return reply({ error: 'Invalid JSON request' }, 400); }
      finally { reader.releaseLock(); }
      if (typeof input?.tool !== 'string' || !input.args || typeof input.args !== 'object' || Array.isArray(input.args)) return reply({ error: 'Invalid tool or arguments' }, 400);
      if (request.signal.aborted) return reply({ error: 'Request cancelled' }, 400);
      try { return reply(await bridge.call(input.tool, input.args)); }
      catch (error) { return reply({ error: error.message }, 502); }
    },
  });
}
