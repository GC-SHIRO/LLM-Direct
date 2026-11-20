"""X-Trainer Feetech SMS/STS gripper (model 10760) over RS-485/USB.

Protocol and register layout follow E:/X-Trainer/X-Trainer-XVLA/deploy/xtrainer/real/hardware/feetech.
Normalized opening: 0.0 = closed, 1.0 = open.
"""

from __future__ import annotations

import threading
import time

from . import config

_HEADER = b"\xff\xff"
_PING, _READ, _WRITE = 1, 2, 3
_MODEL_NUMBER_ADDR = 3
_ACCEL_ADDR = 41
_PRESENT_POSITION_ADDR = 56


class GripperError(RuntimeError):
    pass


def _checksum(payload: bytes) -> int:
    return (~sum(payload)) & 0xFF


class FeetechGripper:
    def __init__(self, port: str, motor_id: int, timeout_s: float = 0.1):
        self.port = port
        self.motor_id = motor_id
        self.timeout_s = timeout_s
        self._serial = None
        self._lock = threading.Lock()
        self.model_number: int | None = None

    def connect(self) -> None:
        import serial  # pyserial

        self._serial = serial.Serial(port=self.port, baudrate=config.GRIPPER_BAUDRATE, timeout=self.timeout_s)
        self._request(_PING)
        b = self._read_bytes(_MODEL_NUMBER_ADDR, 2)
        self.model_number = b[0] | (b[1] << 8)

    def close(self) -> None:
        if self._serial is not None:
            self._serial.close()
            self._serial = None

    def read(self) -> float:
        b = self._read_bytes(_PRESENT_POSITION_ADDR, 2)
        raw = b[0] | (b[1] << 8)
        if raw & 0x8000:
            raw = -(raw & 0x7FFF)
        span = config.GRIPPER_RAW_OPEN - config.GRIPPER_RAW_CLOSED
        return min(1.0, max(0.0, (raw - config.GRIPPER_RAW_CLOSED) / span))

    def write(self, opening: float, speed: int = 4096, accel: int = 0) -> None:
        opening = min(1.0, max(0.0, float(opening)))
        span = config.GRIPPER_RAW_OPEN - config.GRIPPER_RAW_CLOSED
        pos = int(round(config.GRIPPER_RAW_CLOSED + opening * span))
        payload = bytes([_ACCEL_ADDR, accel, pos & 0xFF, pos >> 8, 0, 0, speed & 0xFF, speed >> 8])
        self._request(_WRITE, payload)

    def move_and_wait(self, opening: float, timeout: float = 2.0, settle: float = 0.01) -> float:
        """Command an opening and wait until the position stops changing."""
        self.write(opening)
        t0 = time.monotonic()
        last = self.read()
        stable = 0
        while time.monotonic() - t0 < timeout:
            time.sleep(0.05)
            cur = self.read()
            stable = stable + 1 if abs(cur - last) < settle else 0
            if stable >= 3:
                break
            last = cur
        return self.read()

    # -- transport --------------------------------------------------------
    def _read_bytes(self, addr: int, length: int) -> bytes:
        return self._request(_READ, bytes([addr, length]), response_length=length)

    def _request(self, instr: int, params: bytes = b"", response_length: int = 0) -> bytes:
        if self._serial is None:
            raise GripperError(f"gripper {self.port} not connected")
        body = bytes([self.motor_id, len(params) + 2, instr]) + params
        packet = _HEADER + body + bytes([_checksum(body)])
        with self._lock:
            self._serial.reset_input_buffer()
            self._serial.write(packet)
            resp = self._read_exact(6 + response_length)
        if resp[:2] != _HEADER or resp[2] != self.motor_id:
            raise GripperError(f"bad reply from gripper {self.motor_id}: {resp!r}")
        if resp[-1] != _checksum(resp[2:-1]):
            raise GripperError("gripper checksum mismatch")
        if resp[4]:
            raise GripperError(f"gripper {self.motor_id} error {resp[4]}")
        return resp[5:-1]

    def _read_exact(self, size: int) -> bytes:
        deadline = time.monotonic() + self.timeout_s
        out = bytearray()
        while len(out) < size and time.monotonic() < deadline:
            out += self._serial.read(size - len(out))
        if len(out) != size:
            raise GripperError(f"gripper {self.port} timeout ({len(out)}/{size} bytes)")
        return bytes(out)
