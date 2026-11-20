"""Three RealSense D405 cameras + stitching into one labelled image."""

from __future__ import annotations

import io
import threading
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import config


class RealSenseCameras:
    """Color + aligned depth from the three D405s, read on demand."""

    def __init__(self):
        self._pipes: dict[str, object] = {}
        self._align = None
        self._lock = threading.Lock()
        self._intrinsics: dict[str, object] = {}
        self._last_depth: dict[str, tuple[np.ndarray, float]] = {}

    def connect(self) -> None:
        import pyrealsense2 as rs

        self._rs = rs
        self._align = rs.align(rs.stream.color)
        for name in config.CAMERA_ORDER:
            cfg = rs.config()
            cfg.enable_device(config.CAMERAS[name])
            cfg.enable_stream(rs.stream.color, config.CAMERA_WIDTH, config.CAMERA_HEIGHT, rs.format.rgb8, config.CAMERA_FPS)
            cfg.enable_stream(rs.stream.depth, config.CAMERA_WIDTH, config.CAMERA_HEIGHT, rs.format.z16, config.CAMERA_FPS)
            pipe = rs.pipeline()
            profile = pipe.start(cfg)
            depth_scale = profile.get_device().first_depth_sensor().get_depth_scale()
            color_profile = profile.get_stream(rs.stream.color).as_video_stream_profile()
            self._intrinsics[name] = (color_profile.get_intrinsics(), depth_scale)
            self._pipes[name] = pipe
            for _ in range(10):  # warm-up / auto-exposure
                pipe.wait_for_frames()

    def close(self) -> None:
        for pipe in self._pipes.values():
            try:
                pipe.stop()
            except Exception:
                pass
        self._pipes.clear()

    def read(self, name: str) -> np.ndarray:
        """Return HxWx3 uint8 RGB; keep the aligned depth for get_depth()."""
        with self._lock:
            frames = self._pipes[name].wait_for_frames(1000)
            frames = self._align.process(frames)
            color = np.asanyarray(frames.get_color_frame().get_data()).copy()
            depth = np.asanyarray(frames.get_depth_frame().get_data()).copy()
        if config.CAMERA_ROTATE.get(name, 0) == 180:
            color = np.ascontiguousarray(color[::-1, ::-1])
            depth = np.ascontiguousarray(depth[::-1, ::-1])
        self._last_depth[name] = (depth, time.monotonic())
        return color

    def depth_point(self, name: str, u: int, v: int) -> dict:
        """3D point (mm) in the physical camera (sensor) frame at pixel (u, v) of the displayed image.

        For a 180°-rotated camera the sensor's x/y axes point left/up in the displayed image.
        """
        if name not in self._last_depth:
            self.read(name)
        depth, t = self._last_depth[name]
        intr, scale = self._intrinsics[name]
        h, w = depth.shape
        if not (0 <= u < w and 0 <= v < h):
            raise ValueError(f"pixel ({u},{v}) outside {w}x{h}")
        # median over a 5x5 patch, ignoring zeros
        patch = depth[max(0, v - 2): v + 3, max(0, u - 2): u + 3].astype(float)
        patch = patch[patch > 0]
        if patch.size == 0:
            return {"camera": name, "u": u, "v": v, "valid": False}
        z_m = float(np.median(patch)) * scale
        # (u, v) are in the displayed (possibly rotated) image; deproject in sensor pixel coordinates.
        su, sv = (w - 1 - u, h - 1 - v) if config.CAMERA_ROTATE.get(name, 0) == 180 else (u, v)
        x, y, z = self._rs.rs2_deproject_pixel_to_point(intr, [float(su), float(sv)], z_m)
        return {"camera": name, "u": u, "v": v, "valid": True,
                "point_mm": [round(x * 1000, 1), round(y * 1000, 1), round(z * 1000, 1)],
                "frame_age_s": round(time.monotonic() - t, 3)}


def _font(size: int):
    for name in ("DejaVuSans-Bold.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def stitch(frames: dict[str, np.ndarray], *, width: int, grid: bool, quality: int) -> bytes:
    """Stitch frames left-to-right in CAMERA_ORDER, label each panel, return JPEG bytes.

    With grid=True, a 10x10 grid in each panel's ORIGINAL pixel coordinates
    (640x480) is drawn so the model can name pixels for get_depth().
    """
    names = [n for n in config.CAMERA_ORDER if n in frames]
    panel_w = width // len(names)
    src_h, src_w = frames[names[0]].shape[:2]
    panel_h = int(round(src_h * panel_w / src_w))
    sx = panel_w / src_w
    canvas = Image.new("RGB", (panel_w * len(names), panel_h))
    draw = ImageDraw.Draw(canvas)
    fsize = max(12, panel_h // 22)
    font = _font(fsize)
    small = _font(max(9, panel_h // 40))
    stamp = time.strftime("%H:%M:%S")
    for i, name in enumerate(names):
        img = Image.fromarray(frames[name]).resize((panel_w, panel_h))
        x0 = i * panel_w
        canvas.paste(img, (x0, 0))
        if grid:
            for k in range(1, 10):
                gx = x0 + int(k * src_w / 10 * sx)
                gy = int(k * src_h / 10 * sx)
                draw.line([(gx, 0), (gx, panel_h)], fill=(255, 255, 0), width=1)
                draw.line([(x0, gy), (x0 + panel_w, gy)], fill=(255, 255, 0), width=1)
                draw.text((gx + 2, 2), str(k * src_w // 10), fill=(255, 255, 0), font=small)
                draw.text((x0 + 2, gy + 2), str(k * src_h // 10), fill=(255, 255, 0), font=small)
        label = f"{name}  {stamp}"
        tw = draw.textlength(label, font=font)
        draw.rectangle([x0, panel_h - fsize - 10, x0 + int(tw) + 10, panel_h], fill=(0, 0, 0))
        draw.text((x0 + 5, panel_h - fsize - 7), label, fill=(255, 255, 255), font=font)
        if i:
            draw.line([(x0, 0), (x0, panel_h)], fill=(255, 255, 255), width=2)
    out = io.BytesIO()
    canvas.save(out, format="JPEG", quality=quality)
    return out.getvalue()
