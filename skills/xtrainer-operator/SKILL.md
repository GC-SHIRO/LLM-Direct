---
name: xtrainer-operator
description: Operate the Dobot X-Trainer dual-arm robot (two Nova 2 arms, two grippers, three RealSense cameras) through the llm-direct MCP server. Use whenever a task involves moving the X-Trainer arms or grippers, looking through its cameras, or picking, placing, pushing or handing over objects on its table.
---

# Operating the X-Trainer through llm-direct

You are physically moving a real robot next to people. Every motion is real and some are hard to undo. Work slowly, look before and after every move, and stop when unsure.

Reference files (read when needed; all are also served as MCP resource `robot://skill`):

| File | Read it for |
|---|---|
| [references/platform.md](references/platform.md) | Layout, dimensions, arms, grippers, cameras: what the robot looks like |
| [references/motion.md](references/motion.md) | Coordinate frames, axis directions, how motions behave and how long they take |
| [references/tools.md](references/tools.md) | Every MCP tool: parameters, returns, refusals |
| [references/workflows.md](references/workflows.md) | Step-by-step recipes: approach, grasp, place, push, hand-over, recovery |
| [references/perception.md](references/perception.md) | How to read the stitched images, judge distance and contact, use depth |

## 1. Session start (always, in this order)

1. `get_state()`: both arms present, `robot_mode` = IDLE, `fault` = null. If an arm is faulted or not enabled, report it and stop; you cannot fix it.
2. `get_motion_guide()`: learn which image direction each axis moves for each arm. If it is not recorded, treat every axis direction as unknown until you have verified it with a 10 mm move.
3. `get_images()`: describe the scene briefly: objects, their rough position relative to each gripper, obstacles.
4. State a plan in a few short steps before the first move.

## 2. Operating loop

Repeat until done:

1. **Observe.** Use the image and state returned by your last action. Call `get_images` only if you have none newer than your last action.
2. **Decide one step.** Choose the arm, the axis and the distance. Say in one line what you expect to see afterwards.
3. **Act.** One call: `move_relative`, `move_to_pose`, `move_to_named` or `gripper`.
4. **Check.** Read `ok`, `reason`, the new `tcp_pose` and the returned image. Compare with what you expected.
   - As expected: continue.
   - Different: stop moving, work out why (wrong axis sign? wrong arm? object moved?), then correct with a small step.

Never chain several moves without looking at the result in between.

## 3. Rules (must follow)

1. **Small steps.** Free space: at most 50 mm per move (the server refuses more). Within ~50 mm of an object: 10–20 mm. Final alignment and contact: 2–5 mm.
2. **Verify the axis first.** Before the first larger move along an axis of an arm, confirm its direction in the images, from the motion guide or a 10 mm test move.
3. **Vertical last on approach, first on retreat.** Align above the target first, then descend. After grasping, release or contact, lift first, then move sideways.
4. **One arm at a time** unless the task needs both. Keep the idle arm parked and away from the active arm. Watch the top image for the two arms getting close.
5. **Do not fight refusals.** If the server refuses (`ok: false`), read `reason` and change the plan: smaller step, different route, or ask the user. Never repeat the identical call.
6. **Stop immediately** (`stop()`) when you see an unexpected collision, an object or person entering the workspace, the arm moving in an unexpected direction, or any fault in the state. Then report.
7. **No force sensing.** You cannot feel contact. Infer contact only from images (deformation, object moving) and from the gripper stopping short (`likely_holding_object`). Approach surfaces slowly.
8. **Honest reporting.** Say what you saw, not what you hoped. If a grasp may have failed, say so and check (lift 20 mm and look).
9. **Stay inside the task.** Do not explore, test limits or move to poses the task does not need.
10. **Ask the user** when the goal is ambiguous, an object is not visible, or a step needs more than about 5 corrections.

## 4. Ending

- Open the gripper only where releasing is intended. Leave arms in a safe pose (lifted clear of objects, or `move_to_named("reset")` if the path is clear).
- Summarise: what was done, final state, anything uncertain or left undone.
