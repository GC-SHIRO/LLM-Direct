# Platform: what the X-Trainer looks like

## Overall layout

- A rectangular base plate **1400 × 1000 mm**. A **700 × 700 × 50 mm EVA foam pad** lies in the centre, between the two arms: this is the **work area**. Objects are normally placed on the foam.
- The two arm bases stand about **1064 mm apart**, facing each other across the foam; each base is about 170 mm from the near edge of the foam.
- **Two follower arms** (Dobot Nova 2) stand on the base, mounted **mirror-symmetrically**, one on each side of the work area:
  - `left` = follower 1 (controller 192.168.5.1); its wrist camera is `left_wrist`.
  - `right` = follower 2 (controller 192.168.5.2); its wrist camera is `right_wrist`.
  - Which one appears on which side of the top image: see the top panel (and the motion guide).
- Two small leader arms (teleoperation handles) are also on the base. They are not controlled by you and do not move during your session, but they are physical obstacles.
- A **camera gantry** (two 1.2 m uprights and a 1.32 m crossbar) stands over the base and carries the top camera.
- A status light on the base turns red on a safety stop.

## Arms (Nova 2)

| Property | Value |
|---|---|
| Joints | 6 revolute joints, J1 (base) to J6 (wrist flange) |
| Reach | 625 mm from the base axis |
| Payload | 2 kg |
| Repeatability | ±0.05 mm |
| Joint limits | J1 ±360°, J2 ±180°, J3 ±156°, J4–J6 ±360° |
| Reported pose | position of the **flange centre** (where the gripper is bolted), not the fingertips |

Reachability is better near the middle of the reach. Poses near full stretch (≈600 mm) or very close to the arm's own base are often unreachable or awkward; the server checks inverse kinematics before absolute moves.

**Start pose** ("reset"): the X-Trainer start posture, joints left {-90, 0, -90, 0, 90, 90}° and right {90, 0, 90, 0, -90, -90}°. It is a joint-space target: the path to it is **not** a straight line, so the space around the arm must be clear.

## Grippers

- One parallel two-finger gripper on each arm's flange, driven by a serial servo.
- Opening range 0–95 mm, commanded as **0.0 = closed, 1.0 = fully open**.
- The fingertips are about **197 mm beyond the reported flange position** along the tool axis (see motion.md, Heights). The fingers are visible at the bottom of the wrist view.
- No force sensor. A closing gripper that stops early (`likely_holding_object: true`) is the only grip signal.

## Cameras (Intel RealSense D405, 640 × 480, colour + depth)

| Name | Mounted on | View |
|---|---|---|
| `top` | gantry crossbar, above and behind the work area, tilted down | Whole work area and both arms; best for coarse position, arm-to-arm distance and the overall scene |
| `left_wrist` | left gripper bracket (bracket angle 112°) | Looks along the left gripper's fingers; the fingers appear near the bottom of the image. Best for final alignment and grasp checks |
| `right_wrist` | right gripper bracket | Same for the right gripper |

- The wrist cameras move with the gripper: their view changes with every move and rotation.
- D405 depth works best at about 7–50 cm. Very close (< 7 cm) or very far depth readings are unreliable.

## Things that are physical obstacles

The other arm; the leader arms; the gantry uprights; the base plate edges; cables on the arms; anything the user has placed on the table.
