window.__ModuleLoader__.load({
  id: '@local/dsh-llm-direct-workbench',
  factory(require) {
    const { createElement: h, useEffect, useRef } = require('react');
    /* WORKBENCH_SOURCE */
    const styles = /* WORKBENCH_STYLES */ null;
    const kind = '@local/dsh-llm-direct-workbench';
    const namespace = 'llmDirectWorkbench';
    const copy = {
      en: { title: 'Robot Workbench', description: 'Inspect X-Trainer snapshots and telemetry; manual control is optional' },
      zh: { title: '机器人工作台', description: '查看 X-Trainer 快照与状态，可选择启用手动控制' },
    };
    function icon({ size = 16 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('rect', { x: 4, y: 7, width: 16, height: 12, rx: 3 }),
        h('path', { d: 'M12 3v4M8 12h1m6 0h1m-7 3h6M2 12v3m20-3v3' }));
    }
    async function call(tool, args, signal, endpoint, token, manual) {
      const path = 'api/llm-direct-workbench/call';
      const transport = globalThis.__DSH_TRANSPORT__;
      const init = {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, args, ...(endpoint == null ? {} : { endpoint, ...(token ? { token } : {}), ...(manual === true ? { manual: true } : {}) }) }), signal: AbortSignal.any([signal, AbortSignal.timeout(48_000)]),
      };
      const response = transport?.fetch
        ? await transport.fetch(path, init)
        : await fetch(new URL(path, document.baseURI), { ...init, credentials: 'same-origin' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.error || `DSH HTTP ${response.status}`);
      return body;
    }
    function Body() {
      const root = useRef(null);
      useEffect(() => {
        const controller = new AbortController();
        const dispose = mountWorkbench(root.current, (tool, args, endpoint, token, manual) => call(tool, args, controller.signal, endpoint, token, manual));
        return () => { dispose(); controller.abort(); };
      }, []);
      return h('div', { className: 'llmd-wb-host' }, h('style', null, styles), h('div', { ref: root, className: 'llmd-wb-host__root' }));
    }
    return {
      inject: ['sidebarRight', 'sidebarRightTabs', 'slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(namespace, copy), `${kind}: copy`);
        const t = ctx.locale.bind(namespace);
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: kind, kind, multiple: false, title: () => t('title'), icon,
          guide: [{ id: 'open', order: 60, title: () => t('title'), description: () => t('description'), icon }],
        }), `${kind}: type`);
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: kind }, Body)), `${kind}: body`);
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: kind, locale: namespace }, () => h('span', null, t('title')))), `${kind}: title`);
        ctx.effect(() => () => {
          for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
            if (tab.kind === kind) ctx.sidebarRight.closeIn(tab.sessionId, tab.tabId);
          }
        }, `${kind}: close owned tabs`);
      },
    };
  },
});
