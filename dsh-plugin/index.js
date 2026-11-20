import { isAbsolute } from 'node:path';
import { createBridge } from './bridge.js';
import { isRemoteCommand, isRemoteRead, remoteCall } from './remote.js';

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
      // A supplied endpoint is always remote. Never fall back to the local simulator on error.
      if ('endpoint' in input && (typeof input.endpoint !== 'string' || !input.endpoint.trim())) return reply({ error: 'Invalid remote MCP endpoint' }, 400);
      if ('manual' in input && (!input.endpoint || input.manual !== true || !isRemoteCommand(input.tool))) return reply({ error: 'Invalid remote manual request' }, 400);
      if ('endpoint' in input && !isRemoteRead(input.tool) && !(isRemoteCommand(input.tool) && input.manual === true && input.token)) return reply({ error: 'Remote command requires explicit manual control and token' }, 403);
      if ('token' in input && (!input.endpoint || typeof input.token !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(input.token))) return reply({ error: 'Invalid remote token' }, 400);
      try { return reply('endpoint' in input ? await remoteCall(input.endpoint, input.tool, input.args, request.signal, input.token, input.manual) : await bridge.call(input.tool, input.args)); }
      catch (error) { return reply({ error: error.message }, [400, 403, 409].includes(error.status) ? error.status : 502); }
    },
  });
}
