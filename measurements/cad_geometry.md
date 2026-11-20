# Geometry from the CAD model (no calibration)

Source: `Y:/XTrainer/轻量版3D模型-5.28.step` (SolidWorks 2020 assembly of the X-Trainer lite, 108 parts),
extracted with `scripts/cad_extract.py` → `measurements/cad_tree.json`. All values mm, design values.

## Base frame convention (Dobot controller vs CAD)

The Dobot base frame = CAD "Nova 2-机械臂" assembly frame **rotated −90° about z**
(`x_dobot = −y_cad`, `y_dobot = x_cad`, `z` up in both).

Inferred from the live poses of 2026-11-20 (left TCP (−70, −378, 360), right (70, −343, 410)): with −90° both
grippers lie above the foam and mirror each other; with +90° both would be outside the platform. Holds for either
left/right assignment of the two CAD arms.

## Per arm (in its own Dobot base frame)

| Quantity | Value |
|---|---|
| Origin | J1 axis on the mounting surface (CAD assembly origin; assumed equal to the Dobot origin, see below) |
| +z | up |
| −y | towards the table centre and the other arm |
| ±x | along the line between operator side and back; mirrored between the arms |
| Other arm's base | ≈ 1064 mm along −y (and ≈ 23 mm sideways), its frame rotated 180° |
| Foam (EVA pad) | 700 × 700 × 50, footprint x ≈ −420…+400, y ≈ −890…−170 |
| Foam top surface | z ≈ +42 |
| Gripper length (flange face → fingertips) | ≈ 197 (CAD: 197–202 depending on arm) |
| Flange z with fingertips touching the foam, gripper vertical | ≈ 239 |

## Workspace used in config.py

`x −420…400, y −560…−170, z 255…650` for both arms: the foam footprint, limited to the arm's own half of the
table (y ≥ −560; the centre line is at ≈ −530), and a flange height that keeps vertical fingertips ≥ ~15 mm above the
foam. Widen y towards −890 for hand-overs.

## Open checks

1. **z origin.** If Dobot's base origin were above the mounting surface, all real z values would be lower than
   assumed and z_min = 255 would just be more conservative. Check once with a wrist depth reading at a known pose.
2. **Which CAD arm is "left" (192.168.5.1).** Most likely the one on the operator's left (same side as the leader
   arm `zuo`). Only affects descriptions, not the limits above (they are symmetric).
3. **Top camera.** The real top camera is not where the CAD bracket puts it (the live image shows the follower
   arms near the camera), so camera extrinsics are not taken from CAD.
