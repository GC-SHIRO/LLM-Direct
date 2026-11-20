"""Read-only measurement helper: record labelled TCP poses, then compute geometry.

This script NEVER sends a motion command. It only reads port 30004 of both arms.
Move the arms yourself (Dobot app jog, or the drag/teach button) and press Enter to record.

    python scripts/measure.py record            # interactive recording
    python scripts/measure.py analyze           # compute table height, workspace, arm-to-arm transform
    python scripts/measure.py analyze --file measurements/points.json

Recording input format:  <arm> <label>      e.g.  "left table"  "right corner2"  "left shared1"
Labels understood by `analyze`:
    table*     fingertips just touching the foam, gripper closed, pointing straight down
    corner*    fingertips at a corner of the usable area (any height)
    shared*    fingertips on a marked point that BOTH arms touch (same label for both arms)
Anything else is stored but not analysed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from llm_direct import config  # noqa: E402

DEFAULT_FILE = Path(__file__).resolve().parents[1] / "measurements" / "points.json"


def record(path: Path) -> None:
    from llm_direct.dobot import MODE_NAMES, FeedbackReader

    readers = {a: FeedbackReader(config.ARM_CONFIGS[a].ip) for a in config.ARMS}
    for r in readers.values():
        r.start()
    time.sleep(1.0)
    points = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    print(__doc__.split("Recording input format:")[1])
    print("Commands: '<arm> <label>' to record, 'p' to print poses, 'q' to quit.\n")
    try:
        while True:
            for a, r in readers.items():
                fb = r.latest()
                if fb is None:
                    print(f"  {a:5s}: no feedback ({r.error})")
                else:
                    x, y, z, rx, ry, rz = fb.tcp_pose
                    print(f"  {a:5s}: x={x:8.2f} y={y:8.2f} z={z:8.2f}  rx={rx:7.2f} ry={ry:7.2f} rz={rz:7.2f}"
                          f"  [{MODE_NAMES.get(fb.robot_mode, fb.robot_mode)}]")
            line = input("> ").strip()
            if line in ("q", "quit", "exit"):
                break
            if line in ("", "p"):
                continue
            parts = line.split(maxsplit=1)
            if len(parts) != 2 or parts[0] not in config.ARMS:
                print("  format: left|right <label>")
                continue
            arm, label = parts
            fb = readers[arm].latest()
            if fb is None:
                print("  no feedback, not recorded")
                continue
            # average 20 packets (~160 ms) to remove jitter
            samples = []
            for _ in range(20):
                samples.append(readers[arm].latest().tcp_pose)
                time.sleep(0.009)
            pose = [round(float(v), 3) for v in np.mean(np.array(samples), axis=0)]
            points.append({"arm": arm, "label": label, "pose": pose,
                           "joints_deg": [round(j, 3) for j in fb.joints_deg],
                           "time": time.strftime("%Y-%m-%d %H:%M:%S")})
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(points, indent=1), encoding="utf-8")
            print(f"  recorded {arm} {label}: {pose[:3]}  ({len(points)} points in {path.name})")
    finally:
        for r in readers.values():
            r.stop()


def rigid_2d(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray]:
    """Best rotation (about z, radians) + translation with dst ≈ R @ src + t (Kabsch in 2-D)."""
    cs, cd = src.mean(axis=0), dst.mean(axis=0)
    h = (src - cs).T @ (dst - cd)
    theta = math.atan2(h[0, 1] - h[1, 0], h[0, 0] + h[1, 1])
    r = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
    return theta, cd - r @ cs


def analyze(path: Path) -> None:
    points = json.loads(path.read_text(encoding="utf-8"))
    by = lambda arm, prefix: [p for p in points if p["arm"] == arm and p["label"].startswith(prefix)]
    result: dict = {}
    for arm in config.ARMS:
        res = {}
        table = by(arm, "table")
        if table:
            zs = [p["pose"][2] for p in table]
            res["table_touch_flange_z_mm"] = round(float(np.mean(zs)), 1)
            res["table_touch_spread_mm"] = round(float(np.ptp(zs)), 1)
            res["table_touch_orientation"] = table[0]["pose"][3:]
        corners = by(arm, "corner")
        if len(corners) >= 2:
            xy = np.array([p["pose"][:2] for p in corners])
            res["corners_x_range"] = [round(float(xy[:, 0].min()), 1), round(float(xy[:, 0].max()), 1)]
            res["corners_y_range"] = [round(float(xy[:, 1].min()), 1), round(float(xy[:, 1].max()), 1)]
            if "table_touch_flange_z_mm" in res:
                z0 = res["table_touch_flange_z_mm"]
                res["suggested_workspace_mm"] = (*res["corners_x_range"], *res["corners_y_range"],
                                                 round(z0 + 10, 1), round(z0 + 400, 1))
        result[arm] = res

    # left <-> right transform from shared points
    shared_l = {p["label"]: p["pose"] for p in by("left", "shared")}
    shared_r = {p["label"]: p["pose"] for p in by("right", "shared")}
    common = sorted(set(shared_l) & set(shared_r))
    if len(common) >= 2:
        src = np.array([shared_r[k][:2] for k in common])  # right frame
        dst = np.array([shared_l[k][:2] for k in common])  # left frame
        theta, t = rigid_2d(src, dst)
        r = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
        resid = np.linalg.norm((src @ r.T + t) - dst, axis=1)
        dz = float(np.mean([shared_l[k][2] - shared_r[k][2] for k in common]))
        result["right_to_left"] = {
            "points": common,
            "rotation_about_z_deg": round(math.degrees(theta), 2),
            "translation_xy_mm": [round(float(v), 1) for v in t],
            "z_offset_mm": round(dz, 1),
            "right_base_origin_in_left_frame_mm": [round(float(t[0]), 1), round(float(t[1]), 1), round(-dz, 1)],
            "base_distance_xy_mm": round(float(np.linalg.norm(t)), 1),
            "fit_residual_mm": [round(float(v), 2) for v in resid],
        }
        if len(common) == 2:
            result["right_to_left"]["note"] = "only 2 points: no residual check; record a 3rd shared point"
    print(json.dumps(result, indent=1))
    out = path.with_name("geometry.json")
    out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"\nwritten {out}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=("record", "analyze"))
    p.add_argument("--file", type=Path, default=DEFAULT_FILE)
    a = p.parse_args()
    record(a.file) if a.cmd == "record" else analyze(a.file)


if __name__ == "__main__":
    main()
