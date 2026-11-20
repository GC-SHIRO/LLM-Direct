"""Mock arm / gripper / cameras with the same interfaces as the real drivers.

Lets the MCP server and the model loop run on any machine without hardware.
"""

from __future__ import annotations

import math
import threading
import time

import numpy as np
from PIL import Image, ImageDraw

from . import config
from .dobot import MODE_IDLE, MODE_RUNNING, Feedback

MOCK_SPEED_MM_S = 50.0


class _MockFeedback:
    def __init__(self, arm: "MockArm"):
        self._arm = arm
        self.error = None
        self.resyncs = 0

    def latest(self) -> Feedback:
        a = self._arm
        with a._lock:
            return Feedback(
                host_time=time.monotonic(), robot_mode=a.mode, joints_deg=tuple(a.joints),
                tcp_pose=tuple(a.pose), tcp_force_est=(0.0,) * 6, enable_status=1,
                error_status=0, collision_state=0, digital_inputs=0, digital_outputs=0,
            )


class MockArm:
    def __init__(self, name: str):
        self.ip = f"mock-{name}"
        self._lock = threading.Lock()
        self.mode = MODE_IDLE
        y = 250.0 if name == "left" else -250.0
        self.pose = [300.0, y, 300.0, 180.0, 0.0, 90.0]
        self.joints = list(config.ARM_CONFIGS[name].reset_joints_deg)
        self._target: list[float] | None = None
        self._stop = threading.Event()
        self.feedback = _MockFeedback(self)
        threading.Thread(target=self._sim, daemon=True).start()

    def connect(self): pass
    def close(self): pass
    def enable(self, speed_factor: int): pass
    def set_speed_factor(self, speed_factor: int): pass

    def stop(self):
        with self._lock:
            self._target = None
            self.mode = MODE_IDLE

    def rel_move_base(self, d):
        with self._lock:
            self._target = [p + dv for p, dv in zip(self.pose, d)]
            self.mode = MODE_RUNNING

    def mov_l(self, pose):
        with self._lock:
            self._target = list(pose)
            self.mode = MODE_RUNNING

    def mov_j_joints(self, joints_deg):
        with self._lock:
            self.joints = list(joints_deg)
            self._target = list(self.pose)
            self.mode = MODE_RUNNING

    def inverse_kin_ok(self, pose) -> bool:
        return math.dist(pose[:3], (0, 0, 0)) < 700

    def wait_motion_done(self, timeout: float, start_window: float = 1.0) -> str:
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            if self.mode == MODE_IDLE:
                return "done"
            time.sleep(0.01)
        self.stop()
        return "timeout"

    def _sim(self):
        dt = 0.01
        while True:
            time.sleep(dt)
            with self._lock:
                if self._target is None:
                    continue
                diff = np.array(self._target) - np.array(self.pose)
                dist = float(np.linalg.norm(diff[:3]))
                step = MOCK_SPEED_MM_S * dt
                if dist <= step and np.all(np.abs(diff[3:]) < 1.0):
                    self.pose = list(self._target)
                    self._target = None
                    self.mode = MODE_IDLE
                else:
                    frac = min(1.0, step / dist) if dist > 1e-9 else 1.0
                    self.pose = [p + d * frac for p, d in zip(self.pose, diff)]


class MockGripper:
    def __init__(self, *_args, **_kw):
        self.value = 1.0
        self.model_number = 0

    def connect(self): pass
    def close(self): pass
    def read(self) -> float: return self.value
    def write(self, opening: float): self.value = min(1.0, max(0.0, opening))

    def move_and_wait(self, opening: float, timeout: float = 2.0, settle: float = 0.01) -> float:
        self.write(opening)
        time.sleep(0.2)
        return self.value


class MockCameras:
    """Synthetic frames showing camera name and current mock arm poses."""

    def __init__(self, arms: dict[str, MockArm], grippers: dict[str, MockGripper]):
        self.arms = arms
        self.grippers = grippers

    def connect(self): pass
    def close(self): pass

    def read(self, name: str) -> np.ndarray:
        w, h = config.CAMERA_WIDTH, config.CAMERA_HEIGHT
        img = Image.new("RGB", (w, h), (40, 60, 80) if name == "top" else (60, 50, 40))
        d = ImageDraw.Draw(img)
        d.text((10, 10), f"MOCK {name}", fill=(255, 255, 255))
        if name == "top":  # top-down: plot both TCPs on a 1200x1200 mm table
            for arm_name, arm in self.arms.items():
                x, y = arm.pose[0], arm.pose[1]
                u = int(w / 2 + y * w / 1400)
                v = int(h / 2 + (x - 300) * h / 1000)
                c = (255, 80, 80) if arm_name == "left" else (80, 160, 255)
                d.ellipse([u - 8, v - 8, u + 8, v + 8], fill=c)
                d.text((u + 10, v - 6), f"{arm_name} z={arm.pose[2]:.0f}", fill=c)
        else:
            arm = self.arms["left" if name == "left_wrist" else "right"]
            g = self.grippers["left" if name == "left_wrist" else "right"]
            d.text((10, 30), "pose " + ", ".join(f"{p:.1f}" for p in arm.pose), fill=(255, 255, 255))
            gap = int(20 + 200 * g.read())
            d.rectangle([w // 2 - gap // 2 - 20, h - 120, w // 2 - gap // 2, h], fill=(180, 180, 180))
            d.rectangle([w // 2 + gap // 2, h - 120, w // 2 + gap // 2 + 20, h], fill=(180, 180, 180))
        return np.asarray(img)

    def depth_point(self, name: str, u: int, v: int) -> dict:
        return {"camera": name, "u": u, "v": v, "valid": True, "point_mm": [0.0, 0.0, 400.0], "mock": True}
