# Tools (llm-direct MCP server)

All tools return JSON text. Action tools return `{"ok": true/false, ...}`, and on success also the new arm `state` and, by default, a fresh stitched image (`with_image=true`). When `ok` is false, `reason` says why.

## Observation

### `get_state(arm="both")`
Per arm: `robot_mode` (IDLE / RUNNING / ERROR / COLLISION / DISABLED …), `moving`, `tcp_pose` {x, y, z, rx, ry, rz}, `joints_deg`, `gripper_opening` (0–1), `tcp_force_estimate_N` (rough motor-current estimate, not a sensor: ignore unless very large), `fault` (null when healthy). Cheap: call whenever useful.

### `get_images(grid=false)`
One JPEG, three panels left to right: **top | left_wrist | right_wrist**, each labelled with its name and the capture time. `grid=true` overlays a 10 × 10 pixel grid whose labels are pixel coordinates in each camera's own 640 × 480 image. The grid is only for naming pixels; it is **not** a metric grid.

### `get_depth(camera, u, v)`
3-D point at pixel (u, v) of that camera (640 × 480 coordinates), in mm, in the **camera** frame: x right, y down, z forward (z = distance along the view direction). `valid: false` if there is no depth there. Useful for "how far is this object from the wrist camera" (z). It is **not** a robot coordinate.

### `get_motion_guide(arm="both")`
Pre-recorded direction reference (see motion.md). Call once per session.

## Actions

### `move_relative(arm, dx=0, dy=0, dz=0, drx=0, dry=0, drz=0, with_image=true)`
Straight-line relative move of the flange in the arm's base frame. Limits: translation ≤ 50 mm (per axis and as a vector), rotation ≤ 15° per axis. The target must stay inside the arm's workspace box.

### `move_to_pose(arm, x, y, z, rx, ry, rz, with_image=true)`
Straight-line move to an absolute pose. Refused if outside the workspace, unreachable (inverse kinematics), or more than 200 mm from the current pose.

### `move_to_named(pose, arm="both", with_image=true)`
Joint-space move to a preset. Available: `reset`. With `both`, left moves first, then right.

### `gripper(arm, opening, with_image=true)`
0.0 = closed … 1.0 = open. Returns `final_opening` and `likely_holding_object` (true when a closing command stopped well short of its target).

### `stop(arm="both")`
Immediate stop. Always allowed, never refused.

## Common refusals and what to do

| `reason` contains | Meaning | Do |
|---|---|---|
| `step exceeds` | move too large | split into ≤ 50 mm / ≤ 15° steps |
| `outside workspace` | target leaves the allowed box | choose another route or ask the user |
| `not configured` | the server has no workspace limits for this arm | tell the user; Cartesian moves are unavailable |
| `no inverse-kinematics solution` | pose unreachable | change orientation or approach from another side |
| `more than 200 mm away` | absolute target too far | approach with relative steps first |
| `not idle` / `busy` | arm still moving or in use | `get_state`, wait, retry once |
| `arm faulted` / `not enabled` | safety stop or arm off | stop all activity and report; the operator must recover |
| `operator refused` | supervised mode: the operator declined | do not retry the same move; ask the user why |
| `controller rejected` | the controller returned an error | report the error text; do not retry blindly |
| `timeout` | motion did not finish in 30 s; the arm was stopped | `get_state`, `get_images`, report |

## Server modes

- `supervised`: an operator confirms every motion at the server. Calls may take longer while they decide.
- `dry_run`: nothing moves; results contain `dry_run: true` and `would_execute`. Images do not change.
- `auto`: motions execute directly.
