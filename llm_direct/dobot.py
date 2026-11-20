"""Dobot V4 (Nova 2 / CCBOX) driver: port 29999 commands + port 30004 feedback.

Behaviour measured on this robot:
- RelMovLUser needs user and tool as positional 7th/8th args: RelMovLUser(dx,dy,dz,drx,dry,drz,0,0).
- RobotMode: 3 power off, 4 disabled, 5 idle, 7 running, 9 error, 11 collision.
- 30004 sends a 1440-byte packet every ~8.15 ms. Connect only when reading starts,
  check TestValue on every packet and resync on it.
"""

from __future__ import annotations

import re
import socket
import struct
import threading
import time
from dataclasses import dataclass

DASHBOARD_PORT = 29999
FEEDBACK_PORT = 30004
PACKET_SIZE = 1440
TEST_VALUE = 0x0123456789ABCDEF
TEST_VALUE_BYTES = struct.pack("<Q", TEST_VALUE)
TEST_VALUE_OFFSET = 48

MODE_NAMES = {
    1: "INIT", 2: "BRAKE_OPEN", 3: "POWEROFF", 4: "DISABLED", 5: "IDLE",
    6: "BACKDRIVE", 7: "RUNNING", 8: "SINGLE_MOVE", 9: "ERROR", 10: "PAUSE", 11: "COLLISION",
}
MODE_IDLE = 5
MODE_RUNNING = 7
FAULT_MODES = {3, 4, 9, 11}

_REPLY_RE = re.compile(r"^\s*(-?\d+)\s*,\s*\{(.*?)\}\s*,(.*);?\s*$", re.S)


class DobotError(RuntimeError):
    pass


@dataclass
class Reply:
    error_id: int
    values: str
    raw: str


@dataclass
class Feedback:
    host_time: float  # time.monotonic()
    robot_mode: int
    joints_deg: tuple[float, ...]
    tcp_pose: tuple[float, ...]  # x,y,z mm, rx,ry,rz deg (ToolVectorActual)
    tcp_force_est: tuple[float, ...]  # TCPForce, motor-current estimate
    enable_status: int
    error_status: int
    collision_state: int
    digital_inputs: int
    digital_outputs: int


def parse_feedback(buf: bytes, host_time: float) -> Feedback:
    def d6(off: int) -> tuple[float, ...]:
        return struct.unpack_from("<6d", buf, off)

    return Feedback(
        host_time=host_time,
        robot_mode=struct.unpack_from("<Q", buf, 24)[0],
        joints_deg=d6(432),
        tcp_pose=d6(624),
        tcp_force_est=d6(720),
        enable_status=buf[1026],
        error_status=buf[1029],
        collision_state=buf[1038],
        digital_inputs=struct.unpack_from("<Q", buf, 8)[0],
        digital_outputs=struct.unpack_from("<Q", buf, 16)[0],
    )


class Dashboard:
    """Port 29999. One request at a time (lock); replies end with ';'."""

    def __init__(self, ip: str, timeout_s: float = 5.0):
        self.ip = ip
        self.timeout_s = timeout_s
        self._sock: socket.socket | None = None
        self._lock = threading.Lock()

    def connect(self) -> None:
        s = socket.create_connection((self.ip, DASHBOARD_PORT), timeout=self.timeout_s)
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self._sock = s

    def close(self) -> None:
        if self._sock:
            self._sock.close()
            self._sock = None

    def send(self, cmd: str, check: bool = True) -> Reply:
        with self._lock:
            if self._sock is None:
                raise DobotError("dashboard not connected")
            self._sock.sendall(cmd.encode("ascii"))
            data = b""
            while not data.rstrip().endswith(b";"):
                chunk = self._sock.recv(4096)
                if not chunk:
                    raise DobotError("dashboard connection closed")
                data += chunk
        raw = data.decode("ascii", errors="replace").strip()
        m = _REPLY_RE.match(raw)
        if not m:
            raise DobotError(f"unparseable reply to {cmd!r}: {raw!r}")
        reply = Reply(int(m.group(1)), m.group(2), raw)
        if check and reply.error_id != 0:
            raise DobotError(f"{cmd} -> error {reply.error_id} ({raw})")
        return reply


class FeedbackReader(threading.Thread):
    """Background reader for port 30004; keeps only the latest packet."""

    def __init__(self, ip: str):
        super().__init__(daemon=True, name=f"feedback-{ip}")
        self.ip = ip
        self._latest: Feedback | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.resyncs = 0
        self.error: str | None = None

    def latest(self) -> Feedback | None:
        with self._lock:
            return self._latest

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self._read_loop()
            except OSError as exc:
                self.error = f"{type(exc).__name__}: {exc}"
                time.sleep(0.5)

    def _read_loop(self) -> None:
        with socket.create_connection((self.ip, FEEDBACK_PORT), timeout=2.0) as s:
            buf = bytearray()
            while not self._stop.is_set():
                chunk = s.recv(65536)
                if not chunk:
                    raise OSError("feedback connection closed")
                buf += chunk
                now = time.monotonic()
                last = None
                while len(buf) >= PACKET_SIZE:
                    if buf[TEST_VALUE_OFFSET:TEST_VALUE_OFFSET + 8] != TEST_VALUE_BYTES:
                        idx = buf.find(TEST_VALUE_BYTES, 1)
                        self.resyncs += 1
                        if idx < 0:
                            del buf[: max(0, len(buf) - 8)]
                            break
                        start = idx - TEST_VALUE_OFFSET
                        del buf[: max(start, 1)]
                        continue
                    last = bytes(buf[:PACKET_SIZE])
                    del buf[:PACKET_SIZE]
                if last is not None:
                    fb = parse_feedback(last, now)
                    with self._lock:
                        self._latest = fb
                    self.error = None


def fmt(v: float) -> str:
    return f"{v:.4f}"


class DobotArm:
    """One follower arm: dashboard commands + feedback-based waiting."""

    def __init__(self, ip: str):
        self.ip = ip
        self.dash = Dashboard(ip)
        self.feedback = FeedbackReader(ip)

    def connect(self) -> None:
        self.dash.connect()
        self.feedback.start()
        deadline = time.monotonic() + 3.0
        while self.feedback.latest() is None:
            if time.monotonic() > deadline:
                raise DobotError(f"no 30004 feedback from {self.ip}: {self.feedback.error}")
            time.sleep(0.02)

    def close(self) -> None:
        self.feedback.stop()
        self.dash.close()

    # -- operator-only --------------------------------------------------
    def enable(self, speed_factor: int) -> None:
        self.dash.send("ClearError()")
        self.dash.send("EnableRobot()")
        self._wait_mode({MODE_IDLE}, timeout=10.0)
        self.dash.send(f"SpeedFactor({int(speed_factor)})")

    def set_speed_factor(self, speed_factor: int) -> None:
        self.dash.send(f"SpeedFactor({int(speed_factor)})")

    # -- model-reachable --------------------------------------------------
    def stop(self) -> None:
        self.dash.send("Stop()", check=False)

    def rel_move_base(self, d: tuple[float, ...]) -> None:
        args = ",".join(fmt(v) for v in d)
        self.dash.send(f"RelMovLUser({args},0,0)")

    def mov_l(self, pose: tuple[float, ...]) -> None:
        # Unverified on this controller; user/tool may need to be positional like RelMovLUser.
        self.dash.send("MovL(pose={%s})" % ",".join(fmt(v) for v in pose))

    def mov_j_joints(self, joints_deg: tuple[float, ...]) -> None:
        # Unverified on this controller.
        self.dash.send("MovJ(joint={%s})" % ",".join(fmt(v) for v in joints_deg))

    def inverse_kin_ok(self, pose: tuple[float, ...]) -> bool:
        r = self.dash.send("InverseKin(%s)" % ",".join(fmt(v) for v in pose), check=False)
        return r.error_id == 0

    def wait_motion_done(self, timeout: float, start_window: float = 1.0) -> str:
        """Wait for RobotMode 7 -> 5. Returns 'done', 'fault:<mode>' or 'timeout'."""
        t0 = time.monotonic()
        seen_running = False
        while True:
            fb = self.feedback.latest()
            mode = fb.robot_mode if fb else -1
            if mode in FAULT_MODES:
                return f"fault:{MODE_NAMES.get(mode, mode)}"
            if mode == MODE_RUNNING:
                seen_running = True
            elif mode == MODE_IDLE and (seen_running or time.monotonic() - t0 > start_window):
                return "done"
            if time.monotonic() - t0 > timeout:
                self.stop()
                return "timeout"
            time.sleep(0.01)

    def _wait_mode(self, modes: set[int], timeout: float) -> None:
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            fb = self.feedback.latest()
            if fb and fb.robot_mode in modes:
                return
            time.sleep(0.02)
        fb = self.feedback.latest()
        raise DobotError(f"{self.ip}: RobotMode {fb.robot_mode if fb else None}, expected {modes}")
