# Motion: frames, directions and dynamics

## Coordinate frames

- Every arm uses **its own base frame**. Positions are in **mm**, orientations (`rx, ry, rz`) in **degrees**.
- `+z` points **up**, away from the table, for both arms. This is the one direction you can rely on without the guide.
- `x` and `y` lie in the table plane. Because the arms are mirrored, **the same axis can point in different (often opposite) directions in the images for the left and the right arm.** Never transfer a direction learned on one arm to the other.
- Poses from the two arms are **not comparable** (different frames). To relate them, use the images, not the numbers.
- `drx, dry, drz` in `move_relative` rotate the gripper about the base-frame axes, keeping the flange position. `drz` turns the gripper about the vertical axis; use it to align the fingers with an object's edges.

## Learning the directions: the motion guide

`get_motion_guide()` returns, for each arm, a sheet with one row per move (+x, −x, +y, −y, +z, −z, each 40 mm by default) and four columns: top before | top after | wrist before | wrist after. It also lists the measured TCP change for each move and the operator's notes.

How to use it:
1. For each arm, find in the **top** columns which way the gripper shifts for +x and +y. Write it down in your own words, e.g. "left +x → gripper moves towards the bottom of the top image".
2. In the **wrist** columns, note how the scene shifts. The scene moves the **opposite** way to the gripper (move the gripper right and objects slide left in the wrist image).
3. Keep these mappings for the whole session. If the guide is missing or something disagrees with it, verify with a 10 mm move and trust what you see.

Turning image directions into commands: to bring the gripper towards an object that is "below and to the right" of it in the top image, combine the two axes whose guide rows show "down" and "right" for that arm, and use small steps.

## Motion types

| Tool | Path | Use for |
|---|---|---|
| `move_relative` | straight line of the flange, base frame | almost everything: approach, alignment, lift, push |
| `move_to_pose` | straight line to an absolute pose (≤ 200 mm away) | returning to a pose you recorded earlier from `get_state` |
| `move_to_named` | joint-space (curved path) | parking at "reset" at the start/end, only if the path is clear |

## Dynamics (what to expect)

- Speed is fixed by the operator (SpeedFactor 10 %). You cannot change it. A 10 mm straight move takes roughly 0.3 s; a 40–50 mm move about 1 s, including acceleration and deceleration.
- Every motion call **blocks until the arm has stopped**, then returns. The returned image is taken after the stop.
- Motions are smooth and precise (repeatability ±0.05 mm; a measured 5 mm move landed exactly on target). If the image disagrees with the commanded move, suspect your direction mapping, not the arm.
- Robot state updates every ~8 ms; `get_state` is always fresh.
- The gripper takes roughly 0.2–1 s to open or close.
- `stop()` halts the arm with a short braking distance (not yet measured; expect a few mm at this speed).

## Typical heights (fill in with measured values once available)

- Table / foam surface: z = TODO mm (left), TODO mm (right)
- Safe travel height above the table: table + 100 mm or more
- Fingertip offset below the flange: TODO mm
