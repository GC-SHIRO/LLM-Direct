"""Motion reference guide: pre-recorded "what does +x / -z ... look like" sheets.

Layout on disk (GUIDE_DIR, default <repo>/motion_guide):
    guide.json          machine-readable record: start poses, per-move poses, timing
    notes.md            operator-written conclusions ("left +x = towards the top of the top image")
    <arm>_sheet.jpg     one sheet per arm: rows = moves, columns = top before/after, wrist before/after
    raw/<arm>/...       individual frames
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .cameras import _font

GUIDE_DIR = Path(os.environ.get("LLM_DIRECT_GUIDE_DIR", Path(__file__).resolve().parents[1] / "motion_guide"))
AXES = ("+x", "-x", "+y", "-y", "+z", "-z")
CELL_W, CELL_H = 320, 240
HEADER_H = 28
ROW_LABEL_W = 110

NOTES_TEMPLATE = """# Motion guide notes (operator)

Fill in after looking at the sheets. One line per move; describe what moves where in the TOP image
and in the WRIST image. Keep it short and concrete. The model reads this text first.

## left arm
- +x: TODO
- -x: TODO
- +y: TODO
- -y: TODO
- +z: TODO (expected: up, away from the table)
- -z: TODO (expected: down, towards the table)

## right arm
- +x: TODO
- -x: TODO
- +y: TODO
- -y: TODO
- +z: TODO
- -z: TODO

## other observations
- TODO (e.g. "the two arms are mirrored: left +y and right -y both point to the table centre")
"""


def compose_sheet(arm: str, wrist: str, rows: list[dict], step_mm: float) -> bytes:
    """rows: [{"axis": "+x", "top_before": arr, "top_after": arr, "wrist_before": arr, "wrist_after": arr}]."""
    cols = [("top_before", "top: before"), ("top_after", "top: after"),
            ("wrist_before", f"{wrist}: before"), ("wrist_after", f"{wrist}: after")]
    W = ROW_LABEL_W + CELL_W * len(cols)
    H = HEADER_H * 2 + CELL_H * len(rows)
    sheet = Image.new("RGB", (W, H), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    big, small = _font(18), _font(14)
    d.text((8, 4), f"{arm} arm: relative moves of {step_mm:g} mm in the arm's base frame (RelMovLUser)", fill=(255, 255, 255), font=big)
    for j, (_, title) in enumerate(cols):
        d.text((ROW_LABEL_W + j * CELL_W + 8, HEADER_H + 6), title, fill=(200, 200, 200), font=small)
    for i, row in enumerate(rows):
        y0 = HEADER_H * 2 + i * CELL_H
        d.text((10, y0 + CELL_H // 2 - 20), f"{arm}\n{row['axis']} {step_mm:g} mm", fill=(255, 220, 80), font=big)
        for j, (key, _) in enumerate(cols):
            img = Image.fromarray(row[key]).resize((CELL_W, CELL_H))
            sheet.paste(img, (ROW_LABEL_W + j * CELL_W, y0))
        d.line([(0, y0), (W, y0)], fill=(90, 90, 90), width=1)
        for j in (2,):  # separator between top and wrist pairs
            x = ROW_LABEL_W + j * CELL_W
            d.line([(x, y0), (x, y0 + CELL_H)], fill=(255, 255, 255), width=2)
    out = io.BytesIO()
    sheet.save(out, format="JPEG", quality=82)
    return out.getvalue()


def load(arms=("left", "right")) -> dict:
    """Return {"recorded": bool, "notes": str, "summary": dict, "sheets": {arm: jpeg bytes}}."""
    result = {"recorded": False, "notes": "", "summary": {}, "sheets": {}}
    gj = GUIDE_DIR / "guide.json"
    if gj.exists():
        data = json.loads(gj.read_text(encoding="utf-8"))
        result["summary"] = {a: data["arms"][a] for a in arms if a in data.get("arms", {})}
        result["recorded"] = bool(result["summary"])
        result["meta"] = {k: v for k, v in data.items() if k != "arms"}
    notes = GUIDE_DIR / "notes.md"
    if notes.exists():
        result["notes"] = notes.read_text(encoding="utf-8")
    for a in arms:
        p = GUIDE_DIR / f"{a}_sheet.jpg"
        if p.exists():
            result["sheets"][a] = p.read_bytes()
    return result


def summarize_moves(arm_record: dict) -> list[str]:
    """Human-readable lines: measured TCP change and duration for each recorded move."""
    lines = []
    for axis in AXES:
        m = arm_record.get("moves", {}).get(axis)
        if not m:
            continue
        if not m.get("ok"):
            lines.append(f"- {axis}: FAILED ({m.get('reason')})")
            continue
        b, a = np.array(m["pose_before"][:3]), np.array(m["pose_after"][:3])
        dlt = a - b
        lines.append(f"- {axis}: TCP moved ({dlt[0]:+.1f}, {dlt[1]:+.1f}, {dlt[2]:+.1f}) mm in {m['duration_s']:.2f} s")
    return lines
