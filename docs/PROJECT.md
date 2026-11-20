# LLM-Direct 项目说明（v0.1 baseline）

> 面向客户端适配（DeepSeek Harness，下称 DSH）。本文描述 MCP server 的部署、协议、全部工具的输入输出、错误语义、安全行为，以及 DSH 侧需要处理的适配点。
> 硬件接口细节见 [robot_interfaces.md](robot_interfaces.md)。

---

## 1. 项目概述

LLM-Direct 是一个 **MCP server**，让前沿大模型通过少量离散、有边界的工具直接操作 Dobot X-Trainer：

- 两条 Nova 2 机械臂（`left`、`right`）
- 两个夹爪（每条臂末端一个）
- 三台 RealSense D405 相机（`top` 全局、`left_wrist`、`right_wrist`）

baseline 只做“三目图像 + 机械臂/夹爪控制”，不含仿真、标定和场景建模。

**职责划分**

| 层 | 负责 | 不负责 |
|---|---|---|
| 模型 | 理解任务、看图、决定下一步动作 | 高频控制、安全判断 |
| DSH（客户端） | 对话循环、把 MCP 工具转成模型的 function calling、处理图像、人机界面 | 直接连机器人 |
| LLM-Direct（本项目） | 硬件驱动、阻塞执行、安全层、日志 | 任务规划 |

---

## 2. 架构

```
┌──────────── DSH (任意机器) ────────────┐
│  DeepSeek 模型 ⇄ 对话循环 ⇄ MCP 客户端  │
└───────────────────┬────────────────────┘
                    │ Streamable HTTP  http://<robot-host>:8765/mcp
┌───────────────────▼──────────── Linux 主机 (接机器人) ──────────────┐
│ server.py   FastMCP：8 个工具 + 1 个资源                             │
│ robot.py    门面层：安全检查 / 运动锁 / supervised 确认 / 日志        │
│   ├─ dobot.py    29999 指令 + 30004 反馈线程（~122 Hz）  ×2 臂        │
│   ├─ gripper.py  Feetech SMS/STS，RS-485/USB             ×2 夹爪      │
│   └─ cameras.py  pyrealsense2，彩色 + 对齐深度，拼接      ×3 相机      │
│ mock.py     无硬件时替代以上三者                                     │
└──────────────────────────────────────────────────────────────────────┘
```

**硬件预设（硬编码于 `llm_direct/config.py`，来自 X-Trainer 官方部署代码）**

| 项 | left | right |
|---|---|---|
| 机械臂 IP | 192.168.5.1 | 192.168.5.2 |
| 夹爪串口 / ID | /dev/ttyUSB1 / 21 | /dev/ttyUSB0 / 22 |
| 腕部相机 | left_wrist `412622272997` | right_wrist `412622271417` |
| 全局相机 | top `409122273405` | |
| reset 关节角 (deg) | -90, 0, -90, 0, 90, 90 | 90, 0, 90, 0, -90, -90 |

---

## 3. 部署与启动

### 3.1 安装

```bash
cd LLM-Direct
pip install -e ".[real]"   # 机器人主机：含 pyrealsense2、pyserial
pip install -e .           # 开发机：只跑 mock
```

依赖：Python ≥ 3.10，`mcp>=1.2`，`numpy`，`pillow`。

### 3.2 启动参数

```bash
python -m llm_direct.server [--mock] [--mode dry_run|supervised|auto] [--enable]
                            [--transport http|stdio] [--host 0.0.0.0] [--port 8765] [--log-dir logs]
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--mock` | 关 | 使用模拟硬件，任何机器都能跑 |
| `--mode` | `supervised` | 见 3.3 |
| `--enable` | 关 | 启动时执行 `ClearError()` + `EnableRobot()`；需要操作员在场 |
| `--transport` | `http` | `http` = Streamable HTTP；`stdio` 只用于本机客户端，不能和 `supervised` 同时用 |
| `--host` / `--port` | `0.0.0.0` / `8765` | HTTP 监听地址 |
| `--log-dir` | `logs` | 日志根目录 |

启动成功后打印：`llm-direct MCP on http://0.0.0.0:8765/mcp  mode=... mock=...`

启动时 server 会：连接两臂 29999 和 30004、连接两个夹爪、打开三台相机（各预热 10 帧），并把两臂的 `SpeedFactor` 设为 10。任一步失败都直接退出。

### 3.3 运行模式

| 模式 | 动作类工具的行为 | 用途 |
|---|---|---|
| `dry_run` | 只做全部检查，返回 `"dry_run": true` 和 `would_execute`，不发指令 | 调 prompt、调 DSH |
| `supervised` | 每次运动前在 **server 终端** 打印描述并等待操作员：回车执行，输入其他内容拒绝 | 真机初期 |
| `auto` | 检查通过即执行 | 熟练后 |

`supervised` 下，工具调用会一直阻塞到操作员回应，**DSH 不能对动作调用设短超时**（见 7.4）。

---

## 4. MCP 协议层

- 协议：MCP，传输为 Streamable HTTP，端点 `POST /mcp`
- server 名：`llm-direct`
- 能力：`tools`、`resources`
- `initialize` 返回的 `instructions` 字段带有给模型的总说明（见 6.1），**DSH 应把它放进 system prompt**。

### 4.1 HTTP 交互流程（不用 SDK 时）

所有请求都要带 `Accept: application/json, text/event-stream`，`Content-Type: application/json`。响应可能是 JSON，也可能是 SSE（`text/event-stream`，取 `data:` 行里的 JSON）。

**1）初始化**

```http
POST /mcp
{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocolVersion":"2025-03-26","capabilities":{},
           "clientInfo":{"name":"dsh","version":"0.1"}}}
```

响应头里有 `Mcp-Session-Id`，之后**每个请求都要带上这个头**。

**2）通知已初始化**

```http
POST /mcp   (Mcp-Session-Id: <id>)
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

**3）列出工具**

```http
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

每个工具返回 `name`、`description`、`inputSchema`（JSON Schema）。`Literal` 类型的参数会生成 `enum`。

**4）调用工具**

```http
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"move_relative","arguments":{"arm":"left","dz":-20}}}
```

**5）读取资源**

```http
{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"robot://conventions"}}
```

用 Python 的 `mcp` SDK（`streamablehttp_client` + `ClientSession`）可以省掉以上细节。

### 4.2 工具结果的结构

`tools/call` 的 `result.content` 是一个数组，元素有两种：

```json
{"type": "text",  "text": "<JSON 字符串>"}
{"type": "image", "data": "<base64>", "mimeType": "image/jpeg"}
```

- 所有工具的文本块都是一个 **JSON 对象序列化后的字符串**，DSH 需要再 `json.loads` 一次。
- 动作类工具在成功且 `with_image=true` 时，返回 `[text, image]` 两个块；其他情况只有 `text`。
- `get_images` 只返回一个 `image` 块。
- 新版 SDK 可能额外带 `structuredContent` 字段，内容和文本块重复，以 `content` 为准。

---

## 5. 工具参考

通用约定：
- 长度单位 mm，角度单位 deg，夹爪开合是 0 到 1 的归一化值。
- `arm`：`"left"` 或 `"right"`；部分工具还接受 `"both"`。
- 位姿都在 **该臂自己的基座坐标系** 下，两臂的坐标系不同。
- 所有工具都会写日志（第 8 节）。

### 5.1 `get_state`

读取状态。数据来自 30004 反馈缓存，几乎没有开销，可以随时调用。

| 参数 | 类型 | 默认 |
|---|---|---|
| `arm` | `"left" \| "right" \| "both"` | `"both"` |

返回示例：

```json
{
 "ok": true, "mode": "supervised", "mock": false,
 "arms": {
  "left": {
   "arm": "left",
   "robot_mode": "IDLE",
   "moving": false,
   "tcp_pose": {"x": 301.2, "y": 248.7, "z": 280.0, "rx": 180.0, "ry": 0.0, "rz": 90.0},
   "joints_deg": [-90.0, 0.0, -90.0, 0.0, 90.0, 90.0],
   "tcp_force_estimate_N": [1.2, -0.4, 3.1],
   "feedback_age_s": 0.004,
   "gripper_opening": 1.0,
   "fault": null
  }
 }
}
```

| 字段 | 含义 |
|---|---|
| `robot_mode` | `POWEROFF` / `DISABLED` / `IDLE` / `RUNNING` / `ERROR` / `COLLISION` 等 |
| `tcp_force_estimate_N` | 由电机电流估算，**不是力传感器读数**，只能作粗略参考 |
| `gripper_opening` | 读取失败时为 `null`，并附带 `gripper_error` |
| `fault` | `null` 表示可以运动；否则是不能运动的原因 |

### 5.2 `get_images`

一次拍三台相机，**横向拼接成一张图**，从左到右依次是 `top | left_wrist | right_wrist`。

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `grid` | bool | `false` | 在每个画面上叠加 10×10 黄色网格，刻度是该相机 **原始 640×480 像素坐标**，供 `get_depth` 使用 |

返回：一个 `image/jpeg` 块。默认总宽 1440 px，每个画面 480×360，JPEG 质量 80。每个画面左下角标注相机名和时间（HH:MM:SS），画面之间有白色分隔线。

### 5.3 `get_depth`

| 参数 | 类型 | 说明 |
|---|---|---|
| `camera` | `"top" \| "left_wrist" \| "right_wrist"` | |
| `u`, `v` | int | 该相机 640×480 图像中的像素坐标 |

返回示例：

```json
{"ok": true, "camera": "top", "u": 320, "v": 240, "valid": true,
 "point_mm": [12.3, -45.6, 512.0], "frame_age_s": 0.8}
```

- 坐标在 **相机坐标系** 下：x 向右、y 向下、z 朝前。**尚未转换到机械臂坐标系**，因为还没做手眼标定。
- 取像素周围 5×5 区域非零深度的中值；没有有效深度时 `valid: false`。
- 用的是最近一次 `get_images` 或动作返回图像对应的那一帧（看 `frame_age_s`）。

### 5.4 `move_relative`

TCP 在基座坐标系里做相对直线移动。底层是 `RelMovLUser(dx,dy,dz,drx,dry,drz,0,0)`。

| 参数 | 类型 | 默认 | 限制 |
|---|---|---|---|
| `arm` | `"left" \| "right"` | 必填 | |
| `dx`, `dy`, `dz` | float (mm) | 0 | 单轴和合位移都 ≤ 50 |
| `drx`, `dry`, `drz` | float (deg) | 0 | 每轴 ≤ 15 |
| `with_image` | bool | `true` | 成功时附带执行后的拼接图 |

成功示例：

```json
{"ok": true, "status": "done", "duration_s": 1.42,
 "executed": "RelMovLUser d=(0.0,0.0,-20.0 mm; 0.0,0.0,0.0 deg)",
 "target_xyz": [301.2, 248.7, 260.0],
 "state": { ...同 get_state 中的单臂对象... }}
```

### 5.5 `move_to_pose`

直线移动到绝对位姿。底层是 `MovL(pose={...})`。

| 参数 | 类型 | 说明 |
|---|---|---|
| `arm` | `"left" \| "right"` | |
| `x, y, z, rx, ry, rz` | float | 目标位姿（mm, deg） |
| `with_image` | bool，默认 `true` | |

执行前依次检查：数值有限；在工作空间内；距当前位置 ≤ 200 mm；`InverseKin` 有解。

### 5.6 `move_to_named`

关节运动到预设位姿。底层是 `MovJ(joint={...})`。

| 参数 | 类型 | 默认 |
|---|---|---|
| `pose` | string | 必填；目前只有 `"reset"` |
| `arm` | `"left" \| "right" \| "both"` | `"both"` |
| `with_image` | bool | `true` |

`both` 时 **先左后右依次执行**，前一条失败就不再执行后一条。返回：

```json
{"ok": true, "arms": {"left": {...单次运动结果...}, "right": {...}}}
```

### 5.7 `gripper`

| 参数 | 类型 | 说明 |
|---|---|---|
| `arm` | `"left" \| "right"` | |
| `opening` | float | 0.0 全闭，1.0 全开（约 95 mm） |
| `with_image` | bool，默认 `true` | |

下发后等待位置稳定（最多 2 s）。返回：

```json
{"ok": true, "commanded": 0.0, "final_opening": 0.31, "likely_holding_object": true}
```

`likely_holding_object`：夹爪在闭合过程中停在比目标大 0.05 以上的位置，说明大概率夹住了东西。没有力传感器，这是唯一的接触信号。

### 5.8 `stop`

| 参数 | 类型 | 默认 |
|---|---|---|
| `arm` | `"left" \| "right" \| "both"` | `"both"` |

立即发送 `Stop()`，不经过任何检查，也不需要 supervised 确认。返回 `{"ok": true, "arms": {"left": "stopped", "right": "stopped"}}`。

### 5.9 资源 `robot://conventions`

Markdown 文本，内容是：两臂和相机说明、坐标系约定、步长限制、各臂工作空间、预设位姿列表、夹爪约定和当前运行模式。建议 DSH 在会话开始时读一次，放进 system prompt。

---

## 6. 给模型的上下文

### 6.1 `instructions`（server 自带，原文）

```
You control a Dobot X-Trainer: two Nova 2 arms ("left", "right"), each with a parallel gripper,
and three RealSense cameras (top = fixed global view, left_wrist / right_wrist = on each gripper).

Read resource robot://conventions once before moving. Units: mm and degrees.
Each arm uses its OWN base frame. Moves are small and bounded; large or out-of-workspace
moves are refused with a reason; split them into steps. After every action, look at the
returned image before deciding the next step. Call stop() whenever something looks wrong.
```

### 6.2 推荐的 system prompt 组成

1. DSH 自己的角色和任务说明
2. 上面的 `instructions`
3. `robot://conventions` 的内容
4. 当前任务

### 6.3 推荐的交互循环

```
get_state + get_images  →  模型决定一个动作  →  动作工具（自带新状态和新图）
        ↑                                                  │
        └────────── 模型检查结果，决定继续、修正或 stop ──────┘
```

---

## 7. DSH 适配要点

### 7.1 工具格式转换

MCP 的 `inputSchema` 本身就是 JSON Schema，可以直接放进 OpenAI 兼容的 function calling 格式：

```json
{"type": "function",
 "function": {"name": "<tool.name>", "description": "<tool.description>",
              "parameters": <tool.inputSchema>}}
```

模型返回的 `tool_calls[].function.arguments` 是 JSON 字符串，解析后原样作为 `tools/call` 的 `arguments`。

### 7.2 图像处理（关键决策）

动作工具和 `get_images` 返回 JPEG 图像块。DSH 要根据所用模型选一种处理方式：

| 方式 | 做法 | 适用 |
|---|---|---|
| A. 直接给模型 | 把 image 块转成该模型 API 的图像消息格式（如 `image_url` + `data:image/jpeg;base64,...`） | 模型支持图像输入 |
| B. 视觉代理 | 把图像交给一个支持视觉的模型，生成文字描述后回填给主模型 | 主模型只支持文本 |
| C. 不要图像 | 调用时传 `with_image=false`，只用状态 JSON | 调试或纯文本测试 |

注意：工具结果消息（role `tool`）在很多 API 里只能放文本。方式 A 通常要把图像放到紧随其后的一条 `user` 消息里，并注明“这是上一个工具调用返回的图像”。

### 7.3 结果解析

- 文本块要先 `json.loads`。
- **业务上的拒绝不是协议错误**：参数越界、超出工作空间、臂忙、操作员拒绝等，返回 `isError: false` 加 `{"ok": false, "reason": "..."}`。应把 `reason` 原样交给模型，让它调整。
- **协议或硬件异常** 会返回 `isError: true`，文本是异常信息，比如相机断开、串口超时。DSH 应提示人工检查，一般不再让模型重试。

### 7.4 超时

| 调用 | 建议超时 |
|---|---|
| `get_state`、`get_depth`、`stop` | 5 s |
| `get_images` | 10 s |
| 动作类（`auto` / `dry_run` 模式） | ≥ 40 s（server 内部运动超时为 30 s，超时后自动 `Stop()`） |
| 动作类（`supervised` 模式） | 不设超时，或很长；要等操作员按回车 |

### 7.5 并发与急停

- 每条臂同一时刻只能执行一个运动；并发调用会收到 `"... arm is busy with another motion"`。两条臂可以并行。
- `stop` 不加锁，可以在动作调用阻塞期间并发调用。
- **建议 DSH 界面放一个人工急停按钮，直接调用 `stop("both")`，不经过模型。** 软件急停不能代替实体急停。

### 7.6 会话管理

- server 是单机器人、单状态的，多个 DSH 会话可以同时连接，但会抢同一台机器人。建议 DSH 同一时间只开一个控制会话。
- 机器人报警或碰撞后会 **锁存故障**，所有动作都会被拒绝，直到操作员处理完并重启 server。DSH 遇到 `arm faulted` 时应停止循环并提示人工处理。

### 7.7 本地开发

```bash
python -m llm_direct.server --mock --mode auto --port 8765
```

mock 模式下：
- 机械臂以 50 mm/s 模拟运动，工作空间为 x, y ∈ [-600, 600]、z ∈ [50, 600]。
- `top` 画面是俯视示意图，用圆点标出两个 TCP 的位置。
- 腕部画面显示当前位姿文字，并用两块灰色方块表示夹爪开合。
- `get_depth` 固定返回 `[0, 0, 400]`，并带 `"mock": true`。

足够用来调通 DSH 的连接、工具转换、图像通路和循环逻辑。

---

## 8. 日志

每次启动 server 会新建 `logs/<YYYYmmdd-HHMMSS>/`：

- `calls.jsonl`：每次工具调用一行，格式为 `{"t", "mono", "tool", "args", "result", "image"?}`
- `images/NNNNN_<tool>.jpg`：每次返回给模型的图像

可以用来回放和分析模型行为。DSH 自己的对话日志可以按时间戳与之对齐。

---

## 9. 安全层（server 内部，模型无法绕过）

| 机制 | 内容 |
|---|---|
| 步长 | 相对移动单轴和合位移 ≤ 50 mm，旋转每轴 ≤ 15°；绝对移动距当前位置 ≤ 200 mm |
| 工作空间 | 每条臂一个 xyz 盒子（`config.py`）。**真机尚未配置，未配置前所有笛卡尔运动都会被拒绝** |
| 速度 | `SpeedFactor` 在启动时固定为 10%，模型无法修改 |
| 可达性 | `move_to_pose` 先调用 `InverseKin` 检查 |
| 看门狗 | 30004 反馈超过 0.2 s 没更新就拒绝运动；`ERROR`、`COLLISION` 或报警标志会锁存故障 |
| 状态前置 | 只有 `IDLE` 时才接受运动；`DISABLED` 和 `POWEROFF` 时拒绝，但不锁存 |
| 运动锁 | 每臂一把，防止并发运动 |
| 不暴露的能力 | 使能、清错、坐标系、负载、碰撞等级、`ServoJ` / `ServoP` |

---

## 10. 已知限制与待办

| 项 | 状态 |
|---|---|
| 真机工作空间 `workspace_mm` | **未配置**，真机笛卡尔运动目前不可用 |
| 两臂基座坐标系的轴向说明 | 未写，`robot://conventions` 里是 TODO |
| `MovL(pose={...})`、`MovJ(joint={...})` 写法 | 未在控制器上验证，可能需要像 `RelMovLUser` 那样补上位置参数 `user,tool` |
| `RelMovLUser` | 已在真机验证 |
| 夹爪方向（1 = 开） | 按官方代码设置，未在本项目中实测 |
| 相机到机械臂的标定 | 未做；`get_depth` 只给相机坐标 |
| 双臂防碰撞 | 未实现（两臂基座之间的变换未知），目前靠工作空间盒子间接隔离 |
| 力感知 | 无六维力传感器，只有电流估算值 |
| 急停后恢复 | 需要人工重启控制器和 server |

---

## 11. 版本与兼容性约定

- 工具名和参数名视为对外接口；之后的改动只做向后兼容的扩展（新增可选参数、新增工具）。
- 结果 JSON 只新增字段，不删除、不改名。
- 不兼容的修改会升级主版本号，并在本文档里记录。
