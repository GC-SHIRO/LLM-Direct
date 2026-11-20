"""Run on the agent machine (Windows): check that the llm-direct server on the robot host is reachable.

    python scripts/check_connection.py --url http://<linux-ip>:8765/mcp --token <token>
    (or set LLM_DIRECT_URL / LLM_DIRECT_TOKEN)

Read-only: lists tools/resources, calls get_state and get_images, saves the image. Never moves the robot.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import os
import time
from pathlib import Path

import httpx2
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.environ.get("LLM_DIRECT_URL", "http://127.0.0.1:8765/mcp"))
    p.add_argument("--token", default=os.environ.get("LLM_DIRECT_TOKEN"))
    a = p.parse_args()

    headers = {"Authorization": f"Bearer {a.token}"} if a.token else {}
    # trust_env=False: never route LAN traffic through a system HTTP proxy (e.g. Clash on 127.0.0.1:7890).
    http = httpx2.AsyncClient(headers=headers, trust_env=False, timeout=httpx2.Timeout(60.0))
    async with http, streamable_http_client(a.url, http_client=http) as streams:
        read, write = streams[0], streams[1]
        async with ClientSession(read, write) as s:
            t0 = time.perf_counter()
            await s.initialize()
            print(f"connected to {a.url} in {(time.perf_counter() - t0) * 1000:.0f} ms")
            tools = await s.list_tools()
            print("tools:", [t.name for t in tools.tools])
            res = await s.list_resources()
            print("resources:", [str(r.uri) for r in res.resources])

            t0 = time.perf_counter()
            st = await s.call_tool("get_state", {"arm": "both"})
            print(f"\nget_state ({(time.perf_counter() - t0) * 1000:.0f} ms):\n{st.content[0].text[:800]}")

            t0 = time.perf_counter()
            im = await s.call_tool("get_images", {})
            dt = (time.perf_counter() - t0) * 1000
            img = next(c for c in im.content if getattr(c, "type", "") == "image")
            data = base64.b64decode(img.data)
            out = Path("logs") / "check_connection.jpg"
            out.parent.mkdir(exist_ok=True)
            out.write_bytes(data)
            print(f"\nget_images ({dt:.0f} ms): {len(data) / 1024:.0f} KB -> {out}")


if __name__ == "__main__":
    asyncio.run(main())
