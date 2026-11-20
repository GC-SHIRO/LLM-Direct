# X-Trainer 可用接口清单

> 用途：LLM-Direct 项目（高级模型通过中间 Harness 直接控制机器人）的接口底稿，供后续功能规划使用。
> 来源：本机实测、Dobot TCP/IP 二次开发接口文档 V4.5.1、X-Trainer 用户手册（轻量版）V1.3。
> 标记：**[实测]** 在本机上验证过；**[文档]** 只见于手册或协议文档，尚未在本机验证。

---

## 1. 硬件与连接

| 组件 | 说明 | 连接方式 | 状态 |
|---|---|---|---|
| 从手 1 | Nova 2，控制器 CCBOX | 以太网 `192.168.5.1` | [实测] |
| 从手 2 | Nova 2，控制器 CCBOX | 以太网 `192.168.5.2` | [实测] |
| 主机 | Linux，网卡 `192.168.5.254/24` | — | [实测] |
| 夹爪 ×2 | 每个从手末端一个，最大开合 95 mm | RS-485 → USB-485 转换模块 → 主机；24 V 由电控柜供电 | [文档] |
| 相机 ×3 | Intel RealSense D405：`top` 全局、`left` 从手 1、`right` 从手 2 | USB 3.0 → 主机（与主手分开接不同 hub） | [文档] |
| 主手 ×2 | 6 自由度遥操作主手，带扳机和按键 | USB → 主机 | [文档]，本项目一般不用 |
| 六维力传感器 | **没有**（两个从手的 `SixForceOnline` 都是 0） | — | [实测] |

控制模式需设为：远程控制 > TCP/IP 二次开发。

---

## 2. 机械臂：29999 Dashboard 端口（ASCII 指令）

回复格式：`ErrorID,{values},Cmd(...);`。错误码：`-10000` 指令不存在，`-20000` 参数个数错，`-3000X` 第 X 个必选参数类型错，`-5000X`/`-6000X` 可选参数类型/范围错。

### 2.1 状态与查询

| 指令 | 返回 | 延迟（中位 / 最大） | 状态 |
|---|---|---|---|
| `RobotMode()` | 3 断电、4 未使能、5 空闲、7 运行、9 报警、11 碰撞 | 0.364 / 1.081 ms | [实测] |
| `GetPose()` | 笛卡尔位姿 | 3.774 / 5.679 ms | [实测] |
| `GetAngle()` | 关节角 | — | [文档] |
| `GetErrorID()` | 当前报警 | — | [文档] |
| `InverseKin` / `PositiveKin` | 逆解 / 正解，可用于下发前检查可达性 | — | [文档] |

### 2.2 使能与安全

| 指令 | 说明 | 状态 |
|---|---|---|
| `ClearError()` | 只能清关节过速和碰撞报警；急停后的报警必须松开急停并重启控制器 | [实测] |
| `EnableRobot()` | 约 1.14 s，之后 `RobotMode` = 5 | [实测] |
| `DisableRobot()` | — | [文档] |
| `SpeedFactor(n)` | 全局速度比例 | [实测] |
| `SetCollisionLevel(n)` | 碰撞灵敏度 | [实测] |
| `Stop()` | 停止当前运动并清队列；停止距离未测 | [实测，可用] |
| `Pause()` / `Continue()` / `EmergencyStop()` | — | [文档] |
| `RequestControl()` | **不存在**（`-10000`），无需调用 | [实测] |

**已验证的启动顺序：** `RobotMode()` = 4 → `ClearError()` → `EnableRobot()` → `RobotMode()` = 5 → `SpeedFactor(10)`。

**急停：** 按任一急停，两个从手同时停；从手 2 随后报 `RobotMode` = 3。

### 2.3 运动（队列指令）

| 指令 | 说明 | 状态 |
|---|---|---|
| `RelMovLUser(dx,dy,dz,drx,dry,drz,user,tool)` | 用户坐标系相对直线移动。**`user`、`tool` 必须作为第 7、8 个位置参数给出**（与文档不同）。`RelMovLUser(0,0,-5,0,0,0,0,0)` 实测 Z 精确移动 -5.000000 mm | [实测] |
| `RelMovLUser(..., speed=n)` | 控制器接受但**疑似被忽略**（10 mm 约 0.33 s）。速度目前只能可靠地用 `SpeedFactor` 控制 | [待验证] |
| `MovJ` / `MovL` | 绝对位姿，关节插补 / 直线 | [文档] |
| `RelMovLTool` / `RelJointMovJ` | 工具坐标系相对移动 / 相对关节运动 | [文档] |
| `MoveJog` | 点动 | [文档] |
| `ServoP` / `ServoJ` | 流式伺服。`t` 0.02–3600 s，`gain` 200–1000，`aheadtime` 20–100；不受 `SpeedFactor` 影响 | [文档] |

**判断运动完成：** 下发后轮询 `RobotMode`，从 7 回到 5 即完成。[实测]

### 2.4 IO

| 指令 | 说明 | 状态 |
|---|---|---|
| `DOInstant` | 立即指令，不进运动队列 | [文档] |
| `DO` | 队列指令，等前面的运动执行完才生效 | [文档] |
| `DI` / `ToolDO` | — | [文档] |

控制柜 DI/DO 为 24 V PNP；末端 DO 为 NPN，末端 DI 为 PNP。

---

## 3. 机械臂：30004 实时反馈端口

- 每帧 1440 字节，小端。**实测周期约 8.15 ms（约 122.7 Hz），不是文档写的 8 ms**；空闲和运动中都没有丢帧，最大间隔 10.2 ms。[实测]
- 位置读取优先用 `ToolVectorActual`，不需要往返，比 `GetPose()` 快。

| 字段 | 偏移 | 类型 | 状态 |
|---|---|---|---|
| `MessageSize` | 0 | uint16 | [实测] 值为 1440 |
| `DigitalInputs` | 8 | uint64 | [文档] |
| `DigitalOutputs` | 16 | uint64 | [文档] |
| `RobotMode` | 24 | uint64 | [实测] |
| `TimeStamp` | 32 | uint64，Unix ms | [实测] 与主机时钟差约 19.7 分钟 |
| `TestValue` | 48 | uint64 | [实测] `0x0123456789ABCDEF` |
| `IActual` | 528 | 6 × double | [文档] |
| `ActualTCPForce` | 576 | 6 × double | 无传感器，不可用 |
| `ToolVectorActual` | 624（Z 在 640） | 6 × double | [实测] |
| `TCPForce` | 720 | 6 × double | 电流估算值，精度未知 |
| `SixForceOnline` | 1037 | uint8 | [实测] 两个从手都是 0 |

**读取规则（实测踩过的坑）：**
1. 开始读的时候再连接 30004，不要先连上再等待，否则缓冲区堆满会读到旧数据。
2. 每帧检查 `TestValue`，失步时按它重新对齐。
3. 计时用主机 `time.monotonic_ns()`；`TimeStamp` 只用于粗略的相对时间。

---

## 4. 夹爪与相机（Dobot 官方 Python 工程）

X-Trainer 工程的 `example/` 目录提供以下示例，**尚未在本项目中运行验证**：

| 文件 | 内容 |
|---|---|
| `example_gripper.py` | 控制从手夹爪开合 |
| `example_camera.py` | 获取 D405 的 RGB / 深度图像 |
| `example_dobot_robot.py` | 设置指示灯，读取从手关节角 |
| `example_agent.py` | 读取主手关节角和按键 |
| `example_read_data_from_dataset.py` | 解析采集的数据集 |

其他相关点：
- 夹爪和主手的 USB 端口由 `scripts/1_find_port.py` 设置。
- 相机 ID 需在配置中填写（`top` / `left` / `right`）。
- 官方遥操作脚本 `run_control.py` 内有工作区限制：默认夹爪只能在台面 EVA 泡棉正上方活动。这个限制值可以作为 Harness 工作空间边界的参考。

---

## 5. 已知限制（规划时需考虑）

| 项目 | 影响 |
|---|---|
| 无六维力传感器 | 只有电流估算的 `TCPForce`，不能做精细力控或可靠的接触检测 |
| `speed` 选项可能无效 | 单条指令的速度暂时只能靠 `SpeedFactor` 间接控制 |
| 急停后要重启控制器 | Harness 无法自动恢复，需要人介入 |
| 固件版本未知 | 手册要求从手控制器 ≥ 3.5.7 |
| 单次往返延迟 | 查询 < 1 ms，`GetPose` 约 4 ms；与 LLM 的秒级延迟相比可忽略 |
