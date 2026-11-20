# Perception: reading the images

## The stitched image

- Three panels, left to right: **top | left_wrist | right_wrist**. Each has its name and capture time in the bottom-left corner.
- Check the time stamp when it matters: an action's returned image is captured after the motion stopped.
- Panels are scaled down from 640 × 480. Small details (thin edges, small gaps) are better seen in a wrist view up close than in the top view.

## Top camera

- Use it for **where things are**: which arm is closer to an object, rough offsets, the path between arms, whether objects were disturbed.
- It looks down at an angle, not straight down. Things farther from the camera appear higher and smaller in the image; height above the table is hard to judge from it alone. Use it for horizontal position, the wrist view for height.
- Occlusion: an arm can hide objects behind it. Move the arm away or use the wrist view before concluding that an object is gone.

## Wrist cameras

- Use them for **fine alignment and contact**: centring an object between the fingers, judging finger height above the object, checking that the object is held.
- The fingers are fixed in the wrist image (they move with the camera). The scene shifts opposite to the gripper's motion.
- An object growing larger means the gripper is getting closer. A centred object should stay centred as you descend; if it drifts, correct horizontally before continuing.
- At very close range the image can blur and depth becomes unreliable; rely on small steps.

## Judging distance

- `get_depth(camera, u, v)` gives the distance along the camera view (`z`, mm) to the point at pixel (u, v). Use `get_images(grid=true)` to find (u, v) first. Take a few pixels on the object and use the median; `valid: false` means no reading there (shiny, dark or too-close surfaces).
- The depth point is in the camera frame, not robot coordinates. Use it for "about how far", then move in small steps and re-check.
- Without depth: compare the object's apparent size with the gripper opening (fully open ≈ 95 mm) in the wrist view.

## Judging contact and grasp (no force sensor)

Contact signs: the object shifts, tilts or deforms; foam dents under the fingers; the gripper stops closing early (`likely_holding_object`). A successful grasp: after lifting 20 mm, the object stays fixed relative to the fingers in the wrist view and is no longer on the table in the top view.

## Reporting what you see

Describe positions relative to visible landmarks and to the gripper ("the red cube is about two gripper-widths to the right of the left gripper, on the foam"). Say when you are uncertain. Do not invent objects or positions that are not visible.
