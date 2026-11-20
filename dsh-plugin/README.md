# DSH 机器人工作台（模拟）

适配本机 DSH `0.2.2-rc.1`。在已有会话中打开右侧栏，点 **+ → 机器人工作台 / Robot Workbench**。顶部、左腕和右腕同时显示为一张拼接图，不裁掉任一视角。布局随侧栏宽高压缩，空间太小时可以滚动；右上角「中文 / EN」即时切换面板语言，并记住选择。可以查看双臂状态、选择手臂做 5 mm 点动、开合夹爪、回预设关节姿态或停止双臂。画面在打开、手动刷新和成功动作后更新；可选轮询只刷新状态，不更新画面。连接异常时保留的画面会标记，点动、夹爪及复位受状态检查限制，超时不会重发动作。

## 工作台设置

点击连接状态右侧的滑杆图标打开设置。可选择跟随系统／浅色／深色、位姿与关节读数的小数位数（0–2），以及状态轮询间隔（1、2.5、5 秒）。修改即时生效并仅保存在当前浏览器；「恢复默认」将这三项还原，不更改语言或机器人状态。按 Esc 或「完成」关闭设置。

## 重新安装或迁移

在项目根目录准备 Python 3.10+ 环境（Windows PowerShell，已安装 uv）：

```powershell
uv venv .venv
uv pip install --python .\.venv\Scripts\python.exe -r pyproject.toml
node dsh-plugin/build.mjs
```

复制到新位置后，安装前将 [cordis.patch.yml](<cordis.patch.yml>) 的 `projectDir` 改成新项目的绝对路径。默认使用项目 `.venv` 下的 Windows Python；需要其他解释器时可配置绝对路径 `python`。在 DSH **插件 → 添加插件** 中选择插件目录的绝对路径，安装并启用；已有安装可直接打开右栏，若侧栏没有更新，先刷新客户端，必要时重启 DSH 以重新加载本地模块。停用/移除插件会停止后端并关闭当前窗口中属于它的标签。

## 连接方式和验证

侧栏通过 DSH 自带认证的同源 `/api` 接口调用宿主端；宿主按需启动现有 Python MCP 服务，固定使用 `--mock --mode auto --transport stdio`。不需要另开 HTTP 服务或为聊天单独配置 MCP，也不会连真机。模拟进程和状态由这个插件实例共享，不与聊天里另外配置的 MCP 共享。不会把操作按钮注册成聊天工具。模拟 MCP 调用仍沿用项目的本地日志。

```powershell
node dsh-plugin/smoke.mjs
node dsh-plugin/smoke-client.mjs
node dsh-plugin/smoke-layout.mjs
```

三条分别验证宿主路由到模拟机器人的 stdio 调用、侧栏模块的注册与清理、以及真实 Chromium 的中英文布局和键盘操作。布局测试使用独立夹具，不替代在 DSH 窗口中的视觉检查。软件停止只面向这个模拟后端，不是硬件急停。
