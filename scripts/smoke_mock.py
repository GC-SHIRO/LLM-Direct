"""In-process smoke test of the MCP tools against the mock backend (no network)."""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from llm_direct import server  # noqa: E402
from llm_direct.robot import Robot  # noqa: E402


async def main() -> None:
    server.robot = Robot(mock=True, mode="auto", log_dir=Path(tempfile.mkdtemp()))
    server.robot.connect(enable=False)
    m = server.mcp

    tools = await m.list_tools()
    print("tools:", [t.name for t in tools])
    res = await m.list_resources()
    print("resources:", [str(r.uri) for r in res])

    async def call(name, **kw):
        out = await m.call_tool(name, kw)
        blocks = out.content
        kinds = [type(b).__name__ for b in blocks]
        if getattr(out, "is_error", False) or getattr(out, "isError", False):
            kinds.append("ERROR")
        text = next((b.text for b in blocks if hasattr(b, "text")), "")
        print(f"\n== {name}({kw}) -> {kinds}")
        print(text[:600])
        return blocks

    await call("get_state", arm="left")
    blocks = await call("get_images", grid=True)
    img = next(b for b in blocks if type(b).__name__ == "ImageContent")
    mime = getattr(img, "mime_type", None) or getattr(img, "mimeType", None)
    print("image mime:", mime, "base64 len:", len(img.data))
    import base64
    out_jpg = Path(__file__).resolve().parents[1] / "logs" / "smoke_stitched.jpg"
    out_jpg.parent.mkdir(exist_ok=True)
    out_jpg.write_bytes(base64.b64decode(img.data))
    print("saved", out_jpg)
    await call("move_relative", arm="left", dz=-20)
    await call("move_relative", arm="left", dz=-80)  # refused: step too large
    await call("move_relative", arm="right", dz=-400, with_image=False)  # refused
    await call("gripper", arm="right", opening=0.2, with_image=False)
    await call("move_to_named", pose="reset", arm="both", with_image=False)
    await call("get_depth", camera="top", u=320, v=240)
    await call("stop")
    contents = await m.read_resource("robot://conventions")
    print("\n== conventions\n", list(contents)[0].content[:400])
    await call("get_motion_guide", arm="left")
    skill = list(await m.read_resource("robot://skill"))[0].content
    print("\n== robot://skill:", len(skill), "chars; first line:", skill.splitlines()[0])
    guide = list(await m.read_resource("robot://motion-guide"))[0].content
    print("== robot://motion-guide:", guide.splitlines()[:3])
    prompts = await m.list_prompts()
    print("== prompts:", [p.name for p in prompts])
    pr = await m.get_prompt("operate_xtrainer", {"task": "pick up the red cube"})
    print("== prompt messages:", [type(msg.content).__name__ for msg in pr.messages])
    print("\nlog dir:", server.robot.log_dir, "files:", [p.name for p in server.robot.log_dir.iterdir()])
    server.robot.close()


asyncio.run(main())
