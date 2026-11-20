"""Robot facade: two arms + two grippers + three cameras, with the safety layer.

Everything here is synchronous; server.py calls it from worker threads.
Every method returns a JSON-serialisable dict with "ok" and, on refusal, "reason".
"""

from __future__ import annotations

import json
import math
import sys
import threading
import time
from pathlib import Path

from . import config
from .dobot import FAULT_MODES, MODE_IDLE, MODE_NAMES, MODE_RUNNING, DobotArm, DobotError

MODES = ("dry_run", "supervised", "auto")


class Robot:
    def __init__(self, *, mock: bool, mode: str, log_dir: Path):
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.mock = mock
        self.mode = mode
        self.safety = config.SAFETY
        self._motion_locks = {a: threading.Lock() for a in config.ARMS}
        self._confirm_lock = threading.Lock()
        self.faulted: dict[str, str | None] = {a: None for a in config.ARMS}

        if mock:
            from .mock import MockArm, MockCameras, MockGripper

            self.arms = {a: MockArm(a) for a in config.ARMS}
            self.grippers = {a: MockGripper() for a in config.ARMS}
            self.cameras = MockCameras(self.arms, self.grippers)
        else:
            from .cameras import RealSenseCameras
            from .gripper import FeetechGripper

            self.arms = {a: DobotArm(config.ARM_CONFIGS[a].ip) for a in config.ARMS}
            self.grippers = {
                a: FeetechGripper(config.ARM_CONFIGS[a].gripper_port, config.ARM_CONFIGS[a].gripper_id)
                for a in config.ARMS
            }
            self.cameras = RealSenseCameras()

        self.log_dir = log_dir / time.strftime("%Y%m%d-%H%M%S")
        (self.log_dir / "images").mkdir(parents=True, exist_ok=True)
        self._log_file = open(self.log_dir / "calls.jsonl", "a", encoding="utf-8")
        self._log_lock = threading.Lock()
        self._img_counter = 0

    # ------------------------------------------------------------------ setup
    def connect(self, enable: bool) -> None:
        for arm in self.arms.values():
            arm.connect()
        for g in self.grippers.values():
            g.connect()
        self.cameras.connect()
        if self.mode == "dry_run":
            return  # read-only: do not change any controller setting
        for name, arm in self.arms.items():
            if enable:
                arm.enable(self.safety.speed_factor)
            else:
                arm.set_speed_factor(self.safety.speed_factor)

    def close(self) -> None:
        for arm in self.arms.values():
            try:
                arm.stop()
            except Exception:
                pass
            arm.close()
        for g in self.grippers.values():
            g.close()
        self.cameras.close()
        self._log_file.close()

    # ------------------------------------------------------------------ logging
    def log(self, tool: str, args: dict, result: dict, image: bytes | None = None) -> None:
        entry = {"t": time.strftime("%H:%M:%S"), "mono": round(time.monotonic(), 3),
                 "tool": tool, "args": args, "result": result}
        with self._log_lock:
            if image is not None:
                self._img_counter += 1
                fname = f"{self._img_counter:05d}_{tool}.jpg"
                (self.log_dir / "images" / fname).write_bytes(image)
                entry["image"] = fname
            self._log_file.write(json.dumps(entry, ensure_ascii=False) + "\n")
            self._log_file.flush()

    # ------------------------------------------------------------------ state
    def _check_watchdog(self, name: str) -> dict:
        fb = self.arms[name].feedback.latest()
        if fb is None:
            return {"ok": False, "reason": "no feedback"}
        age = time.monotonic() - fb.host_time
        if age > self.safety.feedback_stale_s:
            return {"ok": False, "reason": f"feedback stale ({age:.2f} s)"}
        # ERROR / COLLISION / alarm flags latch until the server is restarted by the operator.
        if fb.robot_mode in (9, 11) or fb.error_status or fb.collision_state:
            self.faulted[name] = f"RobotMode={MODE_NAMES.get(fb.robot_mode, fb.robot_mode)} error={fb.error_status} collision={fb.collision_state}"
        if self.faulted[name]:
            return {"ok": False, "reason": f"arm faulted: {self.faulted[name]}; operator must recover and restart the server"}
        if fb.robot_mode in FAULT_MODES:  # POWEROFF / DISABLED: not latched
            return {"ok": False, "reason": f"arm not enabled (RobotMode={MODE_NAMES.get(fb.robot_mode)}); operator must enable it"}
        return {"ok": True}

    def arm_state(self, name: str) -> dict:
        fb = self.arms[name].feedback.latest()
        out: dict = {"arm": name}
        if fb is None:
            out["error"] = "no feedback"
        else:
            out.update({
                "robot_mode": MODE_NAMES.get(fb.robot_mode, str(fb.robot_mode)),
                "moving": fb.robot_mode == MODE_RUNNING,
                "tcp_pose": {"x": round(fb.tcp_pose[0], 2), "y": round(fb.tcp_pose[1], 2), "z": round(fb.tcp_pose[2], 2),
                             "rx": round(fb.tcp_pose[3], 2), "ry": round(fb.tcp_pose[4], 2), "rz": round(fb.tcp_pose[5], 2)},
                "joints_deg": [round(j, 2) for j in fb.joints_deg],
                "tcp_force_estimate_N": [round(f, 1) for f in fb.tcp_force_est[:3]],
                "feedback_age_s": round(time.monotonic() - fb.host_time, 3),
            })
        try:
            out["gripper_opening"] = round(self.grippers[name].read(), 3)
        except Exception as exc:
            out["gripper_opening"] = None
            out["gripper_error"] = str(exc)
        w = self._check_watchdog(name)
        out["fault"] = None if w["ok"] else w["reason"]
        return out

    def state(self, arm: str = "both") -> dict:
        names = config.ARMS if arm == "both" else (arm,)
        return {"ok": True, "mode": self.mode, "mock": self.mock,
                "arms": {n: self.arm_state(n) for n in names}}

    # ------------------------------------------------------------------ images
    def frames(self, names=config.CAMERA_ORDER) -> dict:
        """Raw RGB frames (HxWx3 uint8) keyed by camera name."""
        return {n: self.cameras.read(n) for n in names}

    def images(self, *, grid: bool = False) -> bytes:
        from .cameras import stitch

        return stitch(self.frames(), width=self.safety.stitched_width, grid=grid, quality=self.safety.jpeg_quality)

    def depth(self, camera: str, u: int, v: int) -> dict:
        if camera not in config.CAMERAS:
            return {"ok": False, "reason": f"unknown camera {camera!r}; use one of {list(config.CAMERAS)}"}
        try:
            return {"ok": True, **self.cameras.depth_point(camera, u, v)}
        except ValueError as exc:
            return {"ok": False, "reason": str(exc)}

    # ------------------------------------------------------------------ safety
    def _workspace(self, name: str):
        if self.mock:
            return config.MOCK_WORKSPACE_MM
        return config.ARM_CONFIGS[name].workspace_mm

    def _check_target(self, name: str, xyz) -> dict:
        box = self._workspace(name)
        if box is None:
            return {"ok": False, "reason": f"workspace for {name} arm is not configured (config.py); Cartesian moves disabled"}
        x, y, z = xyz
        if not (box[0] <= x <= box[1] and box[2] <= y <= box[3] and box[4] <= z <= box[5]):
            return {"ok": False, "reason": f"target ({x:.1f},{y:.1f},{z:.1f}) outside workspace {box}"}
        return {"ok": True}

    def _confirm(self, description: str) -> bool:
        if self.mode != "supervised":
            return True
        with self._confirm_lock:
            print(f"\n[SUPERVISED] {description}\n  Enter = execute, anything else = refuse: ", end="", file=sys.stderr, flush=True)
            answer = sys.stdin.readline().strip()
        return answer == ""

    def _run_motion(self, name: str, description: str, send, extra: dict | None = None) -> dict:
        """Common path: watchdog -> lock -> confirm -> send -> wait -> report."""
        w = self._check_watchdog(name)
        if not w["ok"]:
            return w
        fb = self.arms[name].feedback.latest()
        if fb.robot_mode != MODE_IDLE:
            return {"ok": False, "reason": f"{name} arm not idle ({MODE_NAMES.get(fb.robot_mode, fb.robot_mode)})"}
        lock = self._motion_locks[name]
        if not lock.acquire(blocking=False):
            return {"ok": False, "reason": f"{name} arm is busy with another motion"}
        try:
            if self.mode == "dry_run":
                return {"ok": True, "dry_run": True, "would_execute": description, **(extra or {})}
            if not self._confirm(f"{name}: {description}"):
                return {"ok": False, "reason": "operator refused"}
            t0 = time.monotonic()
            try:
                send()
            except DobotError as exc:
                return {"ok": False, "reason": f"controller rejected: {exc}"}
            status = self.arms[name].wait_motion_done(self.safety.move_timeout_s)
            result = {"ok": status == "done", "status": status, "duration_s": round(time.monotonic() - t0, 2),
                      "executed": description, **(extra or {})}
            if status != "done":
                result["reason"] = status
            result["state"] = self.arm_state(name)
            return result
        finally:
            lock.release()

    # ------------------------------------------------------------------ motion
    def move_relative(self, name: str, dx: float, dy: float, dz: float,
                      drx: float = 0.0, dry: float = 0.0, drz: float = 0.0) -> dict:
        s = self.safety
        d = (dx, dy, dz, drx, dry, drz)
        if not all(math.isfinite(v) for v in d):
            return {"ok": False, "reason": "non-finite value"}
        if max(abs(dx), abs(dy), abs(dz)) > s.max_step_mm or math.dist((0, 0, 0), (dx, dy, dz)) > s.max_step_mm:
            return {"ok": False, "reason": f"translation step exceeds {s.max_step_mm} mm; split into smaller steps"}
        if max(abs(drx), abs(dry), abs(drz)) > s.max_step_deg:
            return {"ok": False, "reason": f"rotation step exceeds {s.max_step_deg} deg"}
        fb = self.arms[name].feedback.latest()
        if fb is None:
            return {"ok": False, "reason": "no feedback"}
        target = [fb.tcp_pose[i] + d[i] for i in range(3)]
        chk = self._check_target(name, target)
        if not chk["ok"]:
            return chk
        desc = f"RelMovLUser d=({dx:.1f},{dy:.1f},{dz:.1f} mm; {drx:.1f},{dry:.1f},{drz:.1f} deg)"
        return self._run_motion(name, desc, lambda: self.arms[name].rel_move_base(d),
                                {"target_xyz": [round(v, 1) for v in target]})

    def move_to_pose(self, name: str, x: float, y: float, z: float, rx: float, ry: float, rz: float) -> dict:
        pose = (x, y, z, rx, ry, rz)
        if not all(math.isfinite(v) for v in pose):
            return {"ok": False, "reason": "non-finite value"}
        chk = self._check_target(name, pose[:3])
        if not chk["ok"]:
            return chk
        fb = self.arms[name].feedback.latest()
        if fb is not None and math.dist(fb.tcp_pose[:3], pose[:3]) > 4 * self.safety.max_step_mm:
            return {"ok": False, "reason": f"target is more than {4 * self.safety.max_step_mm:.0f} mm away; approach in steps"}
        try:
            if not self.arms[name].inverse_kin_ok(pose):
                return {"ok": False, "reason": "no inverse-kinematics solution for target"}
        except DobotError as exc:
            return {"ok": False, "reason": f"InverseKin failed: {exc}"}
        desc = "MovL pose=(" + ",".join(f"{v:.1f}" for v in pose) + ")"
        return self._run_motion(name, desc, lambda: self.arms[name].mov_l(pose))

    def move_to_named(self, pose_name: str, arm: str = "both") -> dict:
        if pose_name not in config.NAMED_POSES:
            return {"ok": False, "reason": f"unknown pose {pose_name!r}; available: {list(config.NAMED_POSES)}"}
        names = config.ARMS if arm == "both" else (arm,)
        results = {}
        for n in names:  # one arm after the other
            joints = config.NAMED_POSES[pose_name][n]
            desc = f"MovJ to named pose '{pose_name}' joints=(" + ",".join(f"{j:.1f}" for j in joints) + ")"
            results[n] = self._run_motion(n, desc, lambda n=n, j=joints: self.arms[n].mov_j_joints(j))
            if not results[n]["ok"]:
                break
        return {"ok": all(r["ok"] for r in results.values()), "arms": results}

    def gripper(self, name: str, opening: float) -> dict:
        if not math.isfinite(opening) or not 0.0 <= opening <= 1.0:
            return {"ok": False, "reason": "opening must be in [0, 1] (0 closed, 1 open)"}
        w = self._check_watchdog(name)
        if not w["ok"]:
            return w
        if self.mode == "dry_run":
            return {"ok": True, "dry_run": True, "would_execute": f"gripper {name} -> {opening:.2f}"}
        if not self._confirm(f"{name}: gripper -> {opening:.2f}"):
            return {"ok": False, "reason": "operator refused"}
        final = self.grippers[name].move_and_wait(opening)
        # If it stopped well short of a closing command, it is probably holding something.
        blocked = opening < final - 0.05
        return {"ok": True, "commanded": opening, "final_opening": round(final, 3),
                "likely_holding_object": blocked}

    def stop(self, arm: str = "both") -> dict:
        names = config.ARMS if arm == "both" else (arm,)
        out = {}
        for n in names:
            try:
                self.arms[n].stop()
                out[n] = "stopped"
            except Exception as exc:
                out[n] = f"stop failed: {exc}"
        return {"ok": all(v == "stopped" for v in out.values()), "arms": out}
