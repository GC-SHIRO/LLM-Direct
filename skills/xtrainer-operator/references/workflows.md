# Workflows

Distances below are starting points; adjust them to what you see.

## Approach an object (above it)

1. In the **top** image, locate the gripper and the object. Using the motion-guide mapping, pick the axes that reduce the offset.
2. If the gripper is low (near the table or other objects), first `dz +30…50` to travel height.
3. Move horizontally in steps of ≤ 50 mm until the gripper is roughly above the object in the top image.
4. Switch to the **wrist** image: centre the object between the fingers with 5–20 mm steps.
5. Rotate with `drz` (≤ 15° per step) until the fingers are perpendicular to the edges you want to grip.

## Grasp

1. `gripper(arm, 1.0)`: open fully (or wider than the object).
2. Descend with `dz` in steps: −30 mm while far, −10 mm when the object fills much of the wrist view, −5 mm for the last part. Check the wrist image each time: the object must stay centred.
3. Stop when the fingers surround the object at the intended height. Do not push into the table; if the fingertips touch the foam, lift 3–5 mm.
4. `gripper(arm, 0.0)`: close.
   - `likely_holding_object: true` → probably grasped.
   - Closed fully (final ≈ 0) → missed: open, lift 20 mm, re-align, retry.
5. Lift `dz +20` and look: the object must move with the gripper in the wrist image and leave the table in the top image. If not, the grasp failed.

## Place

1. Lift to travel height, move above the target location (top image), descend in small steps.
2. Stop a few mm above the surface (judge from wrist and top images).
3. `gripper(arm, 1.0)`: release.
4. Lift `dz +30` before any sideways move. Confirm in the top image that the object stayed.

## Push / slide

1. Close the gripper (a closed gripper is a better pusher).
2. Lower to just above the table, beside the object, on the side opposite to the push direction.
3. Push in 10–20 mm steps, checking that the object moves and does not tip.
4. Lift before moving back.

## Hand-over between arms

1. Holding arm: lift to a free spot between both arms, at travel height.
2. Receiving arm: open, approach from the side with small steps, using its own wrist image.
3. Receiving arm closes → check `likely_holding_object`.
4. Holding arm opens, then **retreats away first** (sideways or up) before anything else moves.

## Recovery

| Situation | Do |
|---|---|
| Unexpected motion direction | `stop`, re-check the motion guide, test the axis with a 10 mm move |
| Object knocked over or moved | stop the current plan, re-observe, re-plan |
| Grasp slipped (object falls) | open gripper, lift, re-observe |
| Two arms close to each other in the top image | move the idle arm away first, or stop and ask |
| Repeated refusals | stop and explain to the user what you tried |
| Fault reported | `stop()`, no further motion, report to the user |
