# LLM-Direct

MCP harness that lets a frontier model operate the Dobot X-Trainer directly: three RealSense D405 cameras, two Nova 2 arms and two grippers. Baseline version, no simulation.

## Layout

```
llm_direct/
  config.py    hard-coded presets: IPs, camera serials, gripper ports/IDs, reset pose, limits
  dobot.py     Dobot V4 driver: 29999 commands + 30004 feedback thread (TestValue resync)
  gripper.py   Feetech SMS/STS gripper over RS-485/USB
  cameras.py   3 x D405 + stitching into one labelled image
  robot.py     facade + safety layer + call logging
  mock.py      mock arms / grippers / cameras
  server.py    FastMCP tools and resources
scripts/smoke_mock.py   in-process test of every tool against the mock
docs/robot_interfaces.md
```

## Run

```bash
pip install -e .            # add [real] on the robot host: pip install -e ".[real]"

# no hardware, local test without a token
python -m llm_direct.server --mock --mode auto --no-auth --host 127.0.0.1

# real robot, operator confirms every motion with Enter in this terminal
python -m llm_direct.server --mode supervised
# add --enable to run ClearError + EnableRobot at startup
```

The HTTP endpoint is `http://<host>:8765/mcp` (streamable HTTP). `--transport stdio` is for local clients (not allowed together with `supervised`).

## Two-machine setup (server on the robot host, agent on Windows)

```
Windows PC (agent / MCP client) ──LAN──► Linux robot host: llm-direct server :8765
                                            ├─ 192.168.5.x ─► Nova 2 ×2
                                            └─ USB ─► grippers, D405 ×3
```

**Linux robot host** (open an SSH session from Windows, so supervised prompts show up on your screen):

```bash
export LLM_DIRECT_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
echo $LLM_DIRECT_TOKEN                      # copy it to the Windows side
sudo ufw allow from <windows-ip> to any port 8765 proto tcp   # if ufw is active
python -m llm_direct.server --mode supervised        # prints the reachable URLs
```

Use `tmux` so the server survives an SSH disconnect. In `supervised` mode every motion waits for Enter in this SSH window.

**Windows** (check first; this is read-only):

```powershell
conda run -n llm-direct python scripts\check_connection.py --url http://<linux-ip>:8765/mcp --token <token>
```

Claude Code as the agent:

```powershell
claude mcp add --transport http xtrainer http://<linux-ip>:8765/mcp --header "Authorization: Bearer <token>"
```

Other agents: streamable HTTP endpoint `http://<linux-ip>:8765/mcp`, header `Authorization: Bearer <token>`.

Notes:
- Every request without the right token gets HTTP 401. The server refuses to start in HTTP mode without a token (`--no-auth` only for local tests).
- This machine has `HTTPS_PROXY/HTTP_PROXY=127.0.0.1:7890`. Make sure LAN traffic bypasses it (`trust_env=False` in httpx, or `NO_PROXY=<linux-ip>`), otherwise requests to the robot host go through the proxy.
- Plain HTTP on the LAN: the token is visible to anyone sniffing that network. Fine for a lab LAN; use an SSH tunnel (`ssh -L 8765:localhost:8765 user@<linux-ip>`, then `http://127.0.0.1:8765/mcp`) when it is not trusted.

## Tools

| Tool | What it does |
|---|---|
| `get_state(arm)` | TCP pose, joints, gripper opening, mode, fault |
| `get_images(grid)` | stitched `top \| left_wrist \| right_wrist` JPEG; optional pixel grid |
| `get_depth(camera, u, v)` | 3D point in the camera frame (mm) |
| `move_relative(arm, dx..drz)` | bounded straight-line relative move in the base frame |
| `move_to_pose(arm, x..rz)` | absolute straight-line move, IK + workspace checked |
| `move_to_named(pose, arm)` | joint move to a preset (`reset`) |
| `gripper(arm, opening)` | 0 closed .. 1 open |
| `stop(arm)` | immediate stop |

Every action returns its result, the new state and a fresh stitched image. Resource `robot://conventions` describes frames, cameras, limits and named poses.

| `get_motion_guide(arm)` | pre-recorded before/after sheets per axis + measured TCP change + operator notes |

Resources: `robot://conventions`, `robot://skill` (whole operating manual), `robot://motion-guide`. Prompt: `operate_xtrainer(task)` bundles manual + motion guide + sheets + task for clients that inject context at session start.

## Motion guide

```bash
python scripts/record_motion_guide.py --arm both --step 40   # real robot, Enter per move
```

Start each arm in a clear observation pose above the table (≥ 40 mm free in every direction). Then look at `motion_guide/<arm>_sheet.jpg` and fill in `motion_guide/notes.md`; the model reads those notes first. Re-record when a camera or arm mounting changes.

## Skill

`skills/xtrainer-operator/`: `SKILL.md` (session start, operating loop, rules) plus `references/` (platform, motion, tools, workflows, perception). Standard Claude skill format; for other models use `robot://skill` or the `operate_xtrainer` prompt as system context. Fill in the TODO heights in `references/motion.md` once measured.

## Safety layer (in the server, not bypassable by the model)

- Step limits: 50 mm and 15 deg per relative move; absolute moves at most 200 mm from the current pose.
- Per-arm workspace box in `config.py`. **Not set for the real robot yet: Cartesian moves are refused until it is filled in.**
- `SpeedFactor` fixed at startup (10 %).
- Watchdog on 30004: ERROR, COLLISION or alarm flags latch a fault; all motion refused until the server is restarted.
- Modes: `dry_run` (check only), `supervised` (Enter per motion), `auto`.
- Not exposed: enable, clear error, coordinate frames, payload, ServoJ/ServoP.
- Every call is logged to `logs/<session>/calls.jsonl`, with images in `logs/<session>/images/`.

## To do before the first real run

1. Fill `workspace_mm` for both arms in `config.py`: jog to the table corners and read `GetPose`.
2. Describe the axis directions of each arm's base frame in `robot://conventions` (`server.py`).
3. Check `MovJ(joint={...})` and `MovL(pose={...})` on the controller. Only `RelMovLUser(...,0,0)` has been verified; the others may need positional `user,tool` too.
4. Check the gripper direction: the X-Trainer code uses 1.0 = open, 0.0 = closed.
