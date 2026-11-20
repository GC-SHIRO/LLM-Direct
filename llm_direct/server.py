"""LLM-Direct MCP server: three cameras + two X-Trainer arms + grippers.

Run on the Linux host connected to the robot:
    python -m llm_direct.server --mode supervised            # real robot, Enter to confirm each motion
    python -m llm_direct.server --mock --mode auto --no-auth --host 127.0.0.1   # no hardware
    (HTTP mode needs a token: --token or env LLM_DIRECT_TOKEN)
    python -m llm_direct.server --mock --transport stdio     # for local MCP clients
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
from pathlib import Path
from typing import Literal

import anyio
from mcp.server.mcpserver import Image, MCPServer

from . import config, motion_guide
from .robot import Robot

Arm = Literal["left", "right"]
ArmOrBoth = Literal["left", "right", "both"]
CameraName = Literal["top", "left_wrist", "right_wrist"]

INSTRUCTIONS = """\
You control a Dobot X-Trainer: two Nova 2 arms ("left", "right"), each with a parallel gripper,
and three RealSense cameras (top = fixed global view, left_wrist / right_wrist = on each gripper).

Before moving: read the operating manual (resource robot://skill or prompt operate_xtrainer) and
call get_motion_guide to see which way each axis moves in the images. Units: mm and degrees.
Each arm uses its OWN base frame. Moves are small and bounded; large or out-of-workspace
moves are refused with a reason; split them into steps. After every action, look at the
returned image before deciding the next step. Call stop() whenever something looks wrong.
"""

mcp = MCPServer("llm-direct", instructions=INSTRUCTIONS)
robot: Robot | None = None


def _robot() -> Robot:
    assert robot is not None, "robot not initialised"
    return robot


def _text(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False, indent=1)


async def _with_image(tool: str, args: dict, result: dict, with_image: bool):
    """Return [json text, stitched image] and log both."""
    r = _robot()
    img = None
    if with_image:
        img = await anyio.to_thread.run_sync(r.images)
    r.log(tool, args, result, img)
    return [_text(result), Image(data=img, format="jpeg")] if img else _text(result)


# ---------------------------------------------------------------- observation
@mcp.tool()
async def get_state(arm: ArmOrBoth = "both") -> str:
    """Current TCP pose (mm, deg, arm base frame), joint angles, gripper opening (0 closed..1 open),
    robot mode and any fault, for one or both arms. Cheap; call as often as needed."""
    r = _robot()
    result = await anyio.to_thread.run_sync(r.state, arm)
    r.log("get_state", {"arm": arm}, result)
    return _text(result)


@mcp.tool()
async def get_images(grid: bool = False):
    """One stitched image from the three cameras, left to right: top | left_wrist | right_wrist.
    grid=True overlays a pixel grid in each camera's original 640x480 coordinates (use these
    coordinates with get_depth)."""
    r = _robot()
    img = await anyio.to_thread.run_sync(lambda: r.images(grid=grid))
    r.log("get_images", {"grid": grid}, {"ok": True}, img)
    return Image(data=img, format="jpeg")


@mcp.tool()
async def get_depth(camera: CameraName, u: int, v: int) -> str:
    """3D point in mm in the CAMERA frame (x right, y down, z forward) at pixel (u, v) of the
    camera's 640x480 image, from aligned depth. Not yet transformed to the arm base frame."""
    r = _robot()
    result = await anyio.to_thread.run_sync(r.depth, camera, u, v)
    r.log("get_depth", {"camera": camera, "u": u, "v": v}, result)
    return _text(result)


# ---------------------------------------------------------------- action
@mcp.tool()
async def move_relative(arm: Arm, dx: float = 0, dy: float = 0, dz: float = 0,
                        drx: float = 0, dry: float = 0, drz: float = 0, with_image: bool = True):
    """Straight-line relative move of the gripper (TCP) in the arm's base frame.
    Translation in mm (max 50 per step), rotation in degrees (max 15 per axis).
    Blocks until the motion ends; returns the result, the new state and (by default) a fresh image."""
    args = dict(arm=arm, dx=dx, dy=dy, dz=dz, drx=drx, dry=dry, drz=drz)
    result = await anyio.to_thread.run_sync(lambda: _robot().move_relative(arm, dx, dy, dz, drx, dry, drz))
    return await _with_image("move_relative", args, result, with_image and result.get("ok", False))


@mcp.tool()
async def move_to_pose(arm: Arm, x: float, y: float, z: float, rx: float, ry: float, rz: float,
                       with_image: bool = True):
    """Straight-line move to an absolute TCP pose (mm, deg) in the arm's base frame.
    Refused if outside the workspace, unreachable, or more than 200 mm from the current pose."""
    args = dict(arm=arm, x=x, y=y, z=z, rx=rx, ry=ry, rz=rz)
    result = await anyio.to_thread.run_sync(lambda: _robot().move_to_pose(arm, x, y, z, rx, ry, rz))
    return await _with_image("move_to_pose", args, result, with_image and result.get("ok", False))


@mcp.tool()
async def move_to_named(pose: str, arm: ArmOrBoth = "both", with_image: bool = True):
    """Joint move to a preset pose. Available: see robot://conventions ('reset' = X-Trainer start pose).
    With arm='both' the arms move one after the other."""
    args = dict(pose=pose, arm=arm)
    result = await anyio.to_thread.run_sync(lambda: _robot().move_to_named(pose, arm))
    return await _with_image("move_to_named", args, result, with_image and result.get("ok", False))


@mcp.tool()
async def gripper(arm: Arm, opening: float, with_image: bool = True):
    """Set gripper opening: 0.0 = fully closed, 1.0 = fully open (about 95 mm).
    Returns the final opening; likely_holding_object=true if it stopped short while closing."""
    args = dict(arm=arm, opening=opening)
    result = await anyio.to_thread.run_sync(lambda: _robot().gripper(arm, opening))
    return await _with_image("gripper", args, result, with_image and result.get("ok", False))


@mcp.tool()
async def stop(arm: ArmOrBoth = "both") -> str:
    """Immediately stop motion on one or both arms. Always allowed."""
    r = _robot()
    result = await anyio.to_thread.run_sync(r.stop, arm)
    r.log("stop", {"arm": arm}, result)
    return _text(result)


@mcp.tool()
async def get_motion_guide(arm: ArmOrBoth = "both"):
    """Pre-recorded reference: what each +/-x, +/-y, +/-z move of an arm looks like in the top and
    wrist cameras (before/after sheets), the measured TCP change per move, and the operator's notes.
    Call once at the start of a session, and again if you are unsure which way an axis points."""
    names = config.ARMS if arm == "both" else (arm,)
    g = motion_guide.load(names)
    if not g["recorded"]:
        return ("Motion guide not recorded yet (run scripts/record_motion_guide.py). "
                "Find axis directions empirically: make one small move (10 mm) and compare images.")
    parts = [_motion_guide_text(g)]
    for a in names:
        if a in g["sheets"]:
            parts.append(Image(data=g["sheets"][a], format="jpeg"))
    return parts


def _motion_guide_text(g: dict) -> str:
    lines = ["# Motion guide", ""]
    meta = g.get("meta", {})
    if meta:
        lines.append(f"step {meta.get('step_mm')} mm, frame: {meta.get('frame')}, SpeedFactor {meta.get('speed_factor')}%"
                     + ("  (MOCK recording)" if meta.get("mock") else ""))
    for a, rec in g["summary"].items():
        lines += ["", f"## {a} arm (recorded {rec.get('recorded_at')}, start pose {rec.get('start_pose')})"]
        lines += motion_guide.summarize_moves(rec)
    if g["notes"]:
        lines += ["", "## Operator notes", g["notes"]]
    lines += ["", "Sheets: rows = moves; columns = top before | top after | wrist before | wrist after."]
    return "\n".join(lines)


# ---------------------------------------------------------------- resources
@mcp.resource("robot://conventions")
def conventions() -> str:
    """Coordinate frames, cameras, limits and named poses."""
    s = config.SAFETY
    r = _robot()
    lines = [
        "# X-Trainer conventions",
        "",
        "## Arms",
        "- left: Nova 2 at 192.168.5.1, wrist camera left_wrist",
        "- right: Nova 2 at 192.168.5.2, wrist camera right_wrist",
        "- Each arm reports and accepts poses in its OWN base frame: x, y, z in mm; rx, ry, rz in degrees.",
        "- TODO(operator): describe which table direction +x / +y / +z point to for each arm.",
        "",
        "## Cameras (stitched left to right in get_images)",
        "- top: fixed above the table, global view",
        "- left_wrist / right_wrist: mounted on each gripper, look along the fingers",
        "",
        "## Limits",
        f"- max translation per move_relative: {s.max_step_mm} mm; max rotation: {s.max_step_deg} deg per axis",
        f"- move_to_pose: at most {4 * s.max_step_mm:.0f} mm from the current pose",
        f"- speed is fixed by the operator (SpeedFactor {s.speed_factor}%)",
    ]
    for a in config.ARMS:
        box = r._workspace(a)
        lines.append(f"- workspace {a}: " + ("not configured (Cartesian moves refused)" if box is None else
                     f"x {box[0]}..{box[1]}, y {box[2]}..{box[3]}, z {box[4]}..{box[5]} mm"))
    lines += ["", "## Named poses (joint space, deg)"]
    for name, per_arm in config.NAMED_POSES.items():
        lines.append(f"- {name}: " + "; ".join(f"{a}={list(j)}" for a, j in per_arm.items()))
    lines += ["", "## Gripper", "- opening 0.0 = closed, 1.0 = open (~95 mm). No force sensor: contact is judged from opening and images.",
              "", f"## Server mode: {r.mode}" + ("  (MOCK hardware)" if r.mock else "")]
    return "\n".join(lines)


SKILL_DIR = Path(__file__).resolve().parents[1] / "skills" / "xtrainer-operator"


def _skill_text() -> str:
    """SKILL.md followed by every reference file, as one document."""
    parts = []
    main_md = SKILL_DIR / "SKILL.md"
    if main_md.exists():
        text = main_md.read_text(encoding="utf-8")
        if text.startswith("---"):  # drop YAML front matter
            text = text.split("---", 2)[2].lstrip()
        parts.append(text)
    for ref in sorted((SKILL_DIR / "references").glob("*.md")):
        parts.append(ref.read_text(encoding="utf-8"))
    return "\n\n---\n\n".join(parts) if parts else "skill files not found"


@mcp.resource("robot://skill")
def skill_resource() -> str:
    """Operating manual for this robot (the xtrainer-operator skill, all files concatenated)."""
    return _skill_text()


@mcp.resource("robot://motion-guide")
def motion_guide_resource() -> str:
    """Text part of the motion guide (use the get_motion_guide tool for the images)."""
    g = motion_guide.load()
    return _motion_guide_text(g) if g["recorded"] else "Motion guide not recorded yet."


@mcp.prompt(title="Operate the X-Trainer")
def operate_xtrainer(task: str = ""):
    """Session opener: operating manual + motion guide (+ sheets) + the task."""
    msgs = [_skill_text()]
    g = motion_guide.load()
    if g["recorded"]:
        msgs.append(_motion_guide_text(g))
        msgs += [Image(data=b, format="jpeg") for b in g["sheets"].values()]
    msgs.append(f"Task: {task}" if task else
                "You are now the X-Trainer operator. Run the readiness check, report the robot status "
                "in one short message, then wait for instructions.")
    return msgs


# ---------------------------------------------------------------- main
def _lan_addresses() -> list[str]:
    import subprocess

    try:  # Linux: hostname -I lists every interface address
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=2).stdout.split()
        addrs = [a for a in out if a.count(".") == 3 and not a.startswith("127.")]
        if addrs:
            return addrs
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        return sorted({i[4][0] for i in infos if not i[4][0].startswith("127.")})
    except OSError:
        return []


def serve_http(host: str, port: int, token: str | None, mode: str, mock: bool) -> None:
    import uvicorn

    from .auth import BearerTokenMiddleware

    # Host-header (DNS-rebinding) checks only make sense for loopback; LAN clients use the IP.
    app = mcp.streamable_http_app(host=host)
    if token:
        app = BearerTokenMiddleware(app, token)
    addrs = _lan_addresses() if host == "0.0.0.0" else [host]
    print(f"llm-direct MCP  mode={mode} mock={mock} auth={'bearer token' if token else 'NONE'}", flush=True)
    for addr in addrs or [host]:
        print(f"  http://{addr}:{port}/mcp", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="warning")


def main() -> None:
    global robot
    p = argparse.ArgumentParser(description="LLM-Direct MCP server")
    p.add_argument("--mock", action="store_true", help="use mock hardware")
    p.add_argument("--mode", choices=("dry_run", "supervised", "auto"), default="supervised")
    p.add_argument("--enable", action="store_true", help="ClearError + EnableRobot at startup (operator present)")
    p.add_argument("--transport", choices=("http", "stdio"), default="http")
    p.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = all interfaces (LAN access)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--token", default=os.environ.get("LLM_DIRECT_TOKEN"),
                   help="bearer token clients must send (default: env LLM_DIRECT_TOKEN)")
    p.add_argument("--no-auth", action="store_true", help="allow unauthenticated access (loopback/testing only)")
    p.add_argument("--log-dir", default="logs")
    a = p.parse_args()

    if a.transport == "stdio" and a.mode == "supervised":
        p.error("supervised mode reads Enter from the terminal and cannot be used with stdio transport")
    if a.transport == "http" and not a.token and not a.no_auth:
        p.error("set a token (--token or env LLM_DIRECT_TOKEN), e.g.\n"
                f"  export LLM_DIRECT_TOKEN={secrets.token_urlsafe(24)}\n"
                "or pass --no-auth for a local test")

    robot = Robot(mock=a.mock, mode=a.mode, log_dir=Path(a.log_dir))
    robot.connect(enable=a.enable)
    try:
        if a.transport == "stdio":
            mcp.run(transport="stdio")
        else:
            serve_http(a.host, a.port, a.token if not a.no_auth else None, a.mode, a.mock)
    finally:
        robot.close()


if __name__ == "__main__":
    main()
