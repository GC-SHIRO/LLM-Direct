"""Record the motion reference guide on the robot (operator present, hand on the e-stop).

For each arm: from the CURRENT pose (or the reset pose with --from-reset), move +step and
back along each base axis (+x, -x, +y, -y, +z, -z), capturing the top and wrist cameras
before and after each move. Writes motion_guide/guide.json, <arm>_sheet.jpg, raw frames and a
notes.md template for the operator to fill in.

Before running on the real robot:
  - put the arm in a clear "observation" pose above the table centre, with at least
    `step` mm of free space in every direction (including down);
  - the workspace box in config.py must be set (Cartesian moves are refused otherwise).

    python scripts/record_motion_guide.py --arm both --step 40            # real, Enter per move
    python scripts/record_motion_guide.py --mock --arm both               # mock, no hardware
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from llm_direct import config, motion_guide  # noqa: E402
from llm_direct.robot import Robot  # noqa: E402


def jpeg(arr) -> bytes:
    out = io.BytesIO()
    Image.fromarray(arr).save(out, format="JPEG", quality=85)
    return out.getvalue()


def tcp(robot: Robot, arm: str) -> list[float]:
    return [round(v, 2) for v in robot.arms[arm].feedback.latest().tcp_pose]


def record_arm(robot: Robot, arm: str, step: float, raw_dir: Path) -> dict:
    wrist = config.ARM_CONFIGS[arm].wrist_camera
    cams = ("top", wrist)
    raw_dir.mkdir(parents=True, exist_ok=True)
    record = {"start_pose": tcp(robot, arm), "wrist_camera": wrist, "moves": {}}
    rows = []
    for axis in motion_guide.AXES:
        sign = 1.0 if axis[0] == "+" else -1.0
        d = {"x": 0.0, "y": 0.0, "z": 0.0}
        d[axis[1]] = sign * step
        before = robot.frames(cams)
        pose_before = tcp(robot, arm)
        print(f"[{arm}] {axis} {step:g} mm ...", flush=True)
        res = robot.move_relative(arm, d["x"], d["y"], d["z"])
        if not res.get("ok"):
            record["moves"][axis] = {"ok": False, "reason": res.get("reason")}
            print(f"  FAILED: {res.get('reason')}; stopping this arm", flush=True)
            break
        time.sleep(0.3)  # let the image settle
        after = robot.frames(cams)
        pose_after = tcp(robot, arm)
        back = robot.move_relative(arm, -d["x"], -d["y"], -d["z"])
        record["moves"][axis] = {"ok": True, "pose_before": pose_before, "pose_after": pose_after,
                                 "duration_s": res.get("duration_s"), "returned": bool(back.get("ok"))}
        for tag, frames in (("before", before), ("after", after)):
            for cam, arr in frames.items():
                (raw_dir / f"{axis}_{tag}_{cam}.jpg").write_bytes(jpeg(arr))
        rows.append({"axis": axis, "top_before": before["top"], "top_after": after["top"],
                     "wrist_before": before[wrist], "wrist_after": after[wrist]})
        if not back.get("ok"):
            print(f"  return move FAILED: {back.get('reason')}; stopping this arm", flush=True)
            break
    if rows:
        sheet = motion_guide.compose_sheet(arm, wrist, rows, step)
        (motion_guide.GUIDE_DIR / f"{arm}_sheet.jpg").write_bytes(sheet)
    record["end_pose"] = tcp(robot, arm)
    return record


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--arm", choices=("left", "right", "both"), default="both")
    p.add_argument("--step", type=float, default=40.0, help="mm per move (<= 50)")
    p.add_argument("--mock", action="store_true")
    p.add_argument("--auto", action="store_true", help="no Enter confirmation (real robot: not recommended)")
    p.add_argument("--from-reset", action="store_true", help="move to the reset pose first")
    a = p.parse_args()

    mode = "auto" if (a.mock or a.auto) else "supervised"
    robot = Robot(mock=a.mock, mode=mode, log_dir=Path("logs"))
    robot.connect(enable=False)
    gdir = motion_guide.GUIDE_DIR
    gdir.mkdir(parents=True, exist_ok=True)
    gj = gdir / "guide.json"
    data = json.loads(gj.read_text(encoding="utf-8")) if gj.exists() else {"arms": {}}
    try:
        if a.from_reset:
            print(robot.move_to_named("reset", a.arm))
        arms = config.ARMS if a.arm == "both" else (a.arm,)
        for arm in arms:
            data["arms"][arm] = record_arm(robot, arm, a.step, gdir / "raw" / arm)
            data["arms"][arm]["recorded_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        data.update({"step_mm": a.step, "frame": "each arm's own base frame (user=0, tool=0)",
                     "speed_factor": config.SAFETY.speed_factor, "mock": a.mock})
        gj.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        notes = gdir / "notes.md"
        if not notes.exists():
            notes.write_text(motion_guide.NOTES_TEMPLATE, encoding="utf-8")
        print(f"\nwritten to {gdir}")
        for arm in arms:
            print(f"{arm}:\n" + "\n".join(motion_guide.summarize_moves(data["arms"][arm])))
        print(f"\nNext: look at {gdir}/*_sheet.jpg and fill in {notes}")
    finally:
        robot.close()


if __name__ == "__main__":
    main()
