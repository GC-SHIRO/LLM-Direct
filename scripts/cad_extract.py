"""Extract the assembly tree (placements + bounding boxes) from the X-Trainer STEP model.

No CAD kernel needed: parses the AP203 assembly structure directly.

    python scripts/cad_extract.py "Y:/XTrainer/轻量版3D模型-5.28.step" --out measurements/cad_tree.json

Output: one entry per occurrence (path from the root), with its world transform (4x4, mm,
root assembly frame) and the world axis-aligned bounding box of all its geometry
(from B-rep vertex points).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ENT_RE = re.compile(rb"#(\d+)\s*=\s*(.*?);\s*(?=\n#|\nENDSEC)", re.S)
REF_RE = re.compile(r"#(\d+)")
NUM = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"


def load(path: Path) -> dict[int, str]:
    raw = path.read_bytes()
    start = raw.index(b"DATA;") + 5
    ents = {}
    for m in ENT_RE.finditer(raw, start):
        ents[int(m.group(1))] = m.group(2).decode("gbk", "replace").replace("\n", " ").strip()
    return ents


def etype(text: str) -> str:
    return text.split("(", 1)[0].strip() if not text.startswith("(") else "COMPLEX"


def args_str(text: str) -> str:
    return text[text.index("(") + 1: text.rindex(")")]


def refs(text: str) -> list[int]:
    return [int(r) for r in REF_RE.findall(text)]


def strings(text: str) -> list[str]:
    return re.findall(r"'([^']*)'", text)


class Step:
    def __init__(self, ents: dict[int, str]):
        self.e = ents
        self.by_type: dict[str, list[int]] = defaultdict(list)
        for i, t in ents.items():
            self.by_type[etype(t)].append(i)

    def point(self, i: int) -> np.ndarray:
        nums = re.findall(NUM, self.e[i].split(",", 1)[1])
        return np.array([float(v) for v in nums[:3]])

    def direction(self, i: int | None, default) -> np.ndarray:
        if i is None:
            return np.array(default, float)
        v = self.point(i)
        return v / np.linalg.norm(v)

    def axis(self, i: int) -> np.ndarray:
        """AXIS2_PLACEMENT_3D -> 4x4."""
        t = self.e[i]
        parts = args_str(t).split(",")
        loc = int(REF_RE.search(parts[1]).group(1))
        z_ref = REF_RE.search(parts[2]) if len(parts) > 2 else None
        x_ref = REF_RE.search(parts[3]) if len(parts) > 3 else None
        z = self.direction(int(z_ref.group(1)) if z_ref else None, (0, 0, 1))
        x = self.direction(int(x_ref.group(1)) if x_ref else None, (1, 0, 0))
        x = x - z * (x @ z)
        x /= np.linalg.norm(x)
        y = np.cross(z, x)
        m = np.eye(4)
        m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, self.point(loc)
        return m


def build(step: Step):
    e = step.e
    prod_name = {i: strings(e[i])[0] for i in step.by_type["PRODUCT"]}
    pdf_prod = {}
    for t in ("PRODUCT_DEFINITION_FORMATION", "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE"):
        for i in step.by_type[t]:
            pdf_prod[i] = refs(e[i])[0]
    pd_name = {}
    for i in step.by_type["PRODUCT_DEFINITION"]:
        pd_name[i] = prod_name.get(pdf_prod.get(refs(e[i])[0]), f"PD#{i}")

    # PD -> shape representation
    pds_def = {i: refs(e[i])[0] for i in step.by_type["PRODUCT_DEFINITION_SHAPE"]}
    pd_sr = {}
    for i in step.by_type["SHAPE_DEFINITION_REPRESENTATION"]:
        pds, sr = refs(e[i])[:2]
        pd_sr[pds_def.get(pds)] = sr

    # NAUO: parent PD -> [(nauo, child PD)]
    nauo_info = {}
    children = defaultdict(list)
    for i in step.by_type["NEXT_ASSEMBLY_USAGE_OCCURRENCE"]:
        r = refs(e[i])
        parent, child = r[0], r[1]
        nauo_info[i] = (parent, child, strings(e[i])[1] if len(strings(e[i])) > 1 else "")
        children[parent].append((i, child))

    # NAUO -> child-to-parent transform
    nauo_T = {}
    for i in step.by_type["CONTEXT_DEPENDENT_SHAPE_REPRESENTATION"]:
        rr, pds = refs(e[i])[:2]
        nauo = pds_def.get(pds)
        rrt = e[rr]
        m = re.search(r"REPRESENTATION_RELATIONSHIP\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)", rrt)
        idt = int(re.search(r"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)", rrt).group(1))
        rep1, rep2 = int(m.group(1)), int(m.group(2))
        a1, a2 = refs(e[idt])[:2]
        A1, A2 = step.axis(a1), step.axis(a2)
        parent, child, _ = nauo_info[nauo]
        if pd_sr.get(child) == rep1:
            T = A2 @ np.linalg.inv(A1)
        elif pd_sr.get(child) == rep2:
            T = A1 @ np.linalg.inv(A2)
        else:
            T = A2 @ np.linalg.inv(A1)
        nauo_T[nauo] = T

    # SR -> geometry representations (SHAPE_REPRESENTATION_RELATIONSHIP)
    sr_geo = defaultdict(list)
    for i in step.by_type["SHAPE_REPRESENTATION_RELATIONSHIP"]:
        a, b = refs(e[i])[:2]
        sr_geo[a].append(b)
        sr_geo[b].append(a)
    return pd_name, pd_sr, children, nauo_info, nauo_T, sr_geo


def vertex_points(step: Step, rep: int, cache: dict) -> np.ndarray:
    if rep in cache:
        return cache[rep]
    e = step.e
    seen, stack, pts = set(), [r for r in refs(args_str(e[rep]))[:-1]], []
    while stack:
        i = stack.pop()
        if i in seen or i not in e:
            continue
        seen.add(i)
        t = e[i]
        ty = etype(t)
        if ty == "VERTEX_POINT":
            pts.append(step.point(refs(t)[0]))
            continue
        if ty in ("CARTESIAN_POINT", "DIRECTION", "AXIS2_PLACEMENT_3D", "GEOMETRIC_REPRESENTATION_CONTEXT", "COMPLEX"):
            continue
        stack.extend(refs(t))
    arr = np.array(pts) if pts else np.zeros((0, 3))
    cache[rep] = arr
    return arr


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("step", type=Path)
    p.add_argument("--out", type=Path, default=Path("measurements/cad_tree.json"))
    a = p.parse_args()

    print("parsing ...", flush=True)
    step = Step(load(a.step))
    print(f"{len(step.e)} entities", flush=True)
    pd_name, pd_sr, children, nauo_info, nauo_T, sr_geo = build(step)
    child_pds = {c for lst in children.values() for _, c in lst}
    roots = [pd for pd in pd_name if pd not in child_pds and pd in children]
    print("roots:", [pd_name[r] for r in roots], flush=True)

    cache: dict = {}
    out = []

    def part_points(pd):
        sr = pd_sr.get(pd)
        if sr is None:
            return np.zeros((0, 3))
        pts = [vertex_points(step, g, cache) for g in sr_geo.get(sr, []) if g != sr]
        pts = [x for x in pts if len(x)]
        return np.vstack(pts) if pts else np.zeros((0, 3))

    def walk(pd, T, path):
        own = part_points(pd)
        world = (own @ T[:3, :3].T + T[:3, 3]) if len(own) else np.zeros((0, 3))
        allpts = [world]
        idx = len(out)
        out.append({"path": path, "name": pd_name[pd], "T": T.round(4).tolist()})
        for nauo, child in children.get(pd, []):
            sub = walk(child, T @ nauo_T[nauo], path + [pd_name[child]])
            if len(sub):
                allpts.append(sub)
        allpts = [x for x in allpts if len(x)]
        pts = np.vstack(allpts) if allpts else np.zeros((0, 3))
        if len(pts):
            out[idx]["bbox_min"] = pts.min(0).round(2).tolist()
            out[idx]["bbox_max"] = pts.max(0).round(2).tolist()
            local = (pts - T[:3, 3]) @ T[:3, :3]  # points in this occurrence's own frame
            out[idx]["local_min"] = local.min(0).round(2).tolist()
            out[idx]["local_max"] = local.max(0).round(2).tolist()
        return pts

    for r in roots:
        walk(r, np.eye(4), [pd_name[r]])
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} occurrences -> {a.out}")


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    main()
