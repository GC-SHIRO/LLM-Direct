"""Hard-coded X-Trainer presets.

Camera serials, gripper ports/IDs and the reset pose are copied from the
X-Trainer deployment code (E:/X-Trainer/X-Trainer-XVLA/deploy/xtrainer/real and
scripts/xtrainer/run_real.py). Edit here if the hardware changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

ARMS = ("left", "right")


@dataclass(frozen=True)
class ArmConfig:
    name: str
    ip: str
    gripper_port: str
    gripper_id: int
    wrist_camera: str
    # Reset pose, 6 joints in degrees (from XTRAINER_RESET_POSE, radians there).
    reset_joints_deg: tuple[float, ...]
    reset_gripper: float  # normalized, 1.0 = open
    # Workspace box in the arm's own base frame, mm: (xmin, xmax, ymin, ymax, zmin, zmax).
    # None = not configured yet -> Cartesian moves are refused on the real robot.
    workspace_mm: tuple[float, float, float, float, float, float] | None = None


LEFT = ArmConfig(
    name="left",
    ip="192.168.5.1",
    gripper_port="/dev/ttyUSB1",
    gripper_id=21,
    wrist_camera="left_wrist",
    reset_joints_deg=(-90.0, 0.0, -90.0, 0.0, 90.0, 90.0),
    reset_gripper=1.0,
    workspace_mm=None,  # TODO: measure on the real robot
)

RIGHT = ArmConfig(
    name="right",
    ip="192.168.5.2",
    gripper_port="/dev/ttyUSB0",
    gripper_id=22,
    wrist_camera="right_wrist",
    reset_joints_deg=(90.0, 0.0, 90.0, 0.0, -90.0, -90.0),
    reset_gripper=1.0,
    workspace_mm=None,  # TODO: measure on the real robot
)

ARM_CONFIGS = {"left": LEFT, "right": RIGHT}

# RealSense D405 serials, in stitching order.
CAMERAS = {
    "top": "409122273405",
    "left_wrist": "412622272997",
    "right_wrist": "412622271417",
}
CAMERA_ORDER = ("top", "left_wrist", "right_wrist")
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
CAMERA_FPS = 30

# Feetech SMS/STS gripper (model 10760), raw position range.
GRIPPER_BAUDRATE = 1_000_000
GRIPPER_RAW_CLOSED = 2048  # normalized 0.0
GRIPPER_RAW_OPEN = 3052  # normalized 1.0


@dataclass(frozen=True)
class SafetyConfig:
    max_step_mm: float = 50.0  # per relative move, per axis and as vector norm
    max_step_deg: float = 15.0  # per rotation axis
    speed_factor: int = 10  # global SpeedFactor, set at startup, not exposed
    move_timeout_s: float = 30.0
    feedback_stale_s: float = 0.2
    stitched_width: int = 1440  # width of the stitched 3-camera image
    jpeg_quality: int = 80


SAFETY = SafetyConfig()

# Workspace used by the mock backend only.
MOCK_WORKSPACE_MM = (-600.0, 600.0, -600.0, 600.0, 50.0, 600.0)


@dataclass
class NamedPoses:
    """Joint-space named poses (degrees). 'reset' comes from the X-Trainer code."""

    poses: dict[str, dict[str, tuple[float, ...]]] = field(
        default_factory=lambda: {
            "reset": {"left": LEFT.reset_joints_deg, "right": RIGHT.reset_joints_deg},
        }
    )


NAMED_POSES = NamedPoses().poses
