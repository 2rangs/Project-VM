#!/usr/bin/env python3
"""
PROJECT V — tiny dependency-free raster canvas (numpy + zlib) for the schematic map PNGs.

Not a general drawing library: lines, discs, rings, filled cells and a built-in 5x7
bitmap font, enough to draw a zone graph over a walkable-footprint silhouette without
needing matplotlib/Pillow on the machine that owns the geometry.
"""
import struct
import zlib
import numpy as np

_FONT = {
    "A": "0111010001100011111110001100011000100000", "B": "1111010001100011111010001100011111000000",
    "C": "0111010001100001000010000100010111000000", "D": "1111010001100011000110001100011111000000",
    "E": "1111110000100001111010000100001111100000", "F": "1111110000100001111010000100001000000000",
    "G": "0111010001100001011110001100010111100000", "H": "1000110001100011111110001100011000100000",
    "I": "0111000100001000010000100001000111000000", "J": "0011100010000100001000010100100110000000",
    "K": "1000110010101001100010100100101000100000", "L": "1000010000100001000010000100001111100000",
    "M": "1000111011101011010110001100011000100000", "N": "1000111001101011001110001100011000100000",
    "O": "0111010001100011000110001100010111000000", "P": "1111010001100011111010000100001000000000",
    "Q": "0111010001100011000110101100100110100000", "R": "1111010001100011111010100100101000100000",
    "S": "0111110000100000111000001000011111000000", "T": "1111100100001000010000100001000010000000",
    "U": "1000110001100011000110001100010111000000", "V": "1000110001100011000110001010100010000000",
    "W": "1000110001100011010110101110111000100000", "X": "1000110001010100010001010100011000100000",
    "Y": "1000110001010100010000100001000010000000", "Z": "1111100001000100010001000100001111100000",
    "0": "0111010001100111010111001100010111000000", "1": "0010001100001000010000100001000111000000",
    "2": "0111010001000010001000100010001111100000", "3": "1111000001000010111000001000011111000000",
    "4": "0001000110010101001011111000100001000000", "5": "1111110000111100000100001100010111000000",
    "6": "0011001000100001111010001100010111000000", "7": "1111100001000100010001000010000100000000",
    "8": "0111010001100010111010001100010111000000", "9": "0111010001100010111100001000100110000000",
    "-": "0000000000000001111100000000000000000000", " ": "0000000000000000000000000000000000000000",
    ".": "0000000000000000000000000001100011000000", ":": "0000001100011000000001100011000000000000",
    "/": "0000100001000100010001000100001000000000", "%": "1100111010000100010001000101110011000000",
    "(": "0001000100010000100001000001000001000000", ")": "0100000100000100001000010001000100000000",
    ">": "0100000100000100000100010001000100000000", "=": "0000000000111110000011111000000000000000",
    ",": "0000000000000000000000000001100001000100", "+": "0000000100001001111100100001000000000000",
}


class Canvas:
    def __init__(self, width, height, bg=(255, 255, 255)):
        self.w, self.h = int(width), int(height)
        self.px = np.empty((self.h, self.w, 3), dtype=np.uint8)
        self.px[:] = bg

    def _blend(self, ys, xs, color, alpha=1.0):
        ok = (xs >= 0) & (xs < self.w) & (ys >= 0) & (ys < self.h)
        ys, xs = ys[ok], xs[ok]
        if alpha >= 1.0:
            self.px[ys, xs] = color
        else:
            c = np.asarray(color, dtype=np.float32)
            self.px[ys, xs] = (self.px[ys, xs] * (1 - alpha) + c * alpha).astype(np.uint8)

    def cells(self, xs, ys, size, color, alpha=1.0):
        """Fill size x size squares whose top-left corners are (xs, ys)."""
        s = max(1, int(round(size)))
        oy, ox = np.meshgrid(np.arange(s), np.arange(s), indexing="ij")
        X = (np.asarray(xs)[:, None] + ox.ravel()[None, :]).ravel().astype(np.int64)
        Y = (np.asarray(ys)[:, None] + oy.ravel()[None, :]).ravel().astype(np.int64)
        self._blend(Y, X, color, alpha)

    def disc(self, cx, cy, r, color, alpha=1.0):
        r = float(r)
        y0, y1 = int(cy - r - 1), int(cy + r + 2)
        x0, x1 = int(cx - r - 1), int(cx + r + 2)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        m = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
        self._blend(yy[m], xx[m], color, alpha)

    def ring(self, cx, cy, r, color, width=2.0):
        y0, y1 = int(cy - r - width - 1), int(cy + r + width + 2)
        x0, x1 = int(cx - r - width - 1), int(cx + r + width + 2)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        m = np.abs(d - r) <= width / 2
        self._blend(yy[m], xx[m], color)

    def line(self, x0, y0, x1, y1, color, width=1.0, alpha=1.0, dash=None):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 2
        t = np.linspace(0.0, 1.0, n)
        if dash:
            length = float(np.hypot(x1 - x0, y1 - y0))
            t = t[((t * length) % (dash[0] + dash[1])) < dash[0]]
        xs, ys = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        r = max(0.0, (width - 1) / 2)
        k = int(np.ceil(r))
        pts = set()
        for dy in range(-k, k + 1):
            for dx in range(-k, k + 1):
                if dx * dx + dy * dy <= r * r + 0.3:
                    pts.update(zip(np.rint(ys + dy).astype(int).tolist(), np.rint(xs + dx).astype(int).tolist()))
        if not pts:
            return
        arr = np.array(list(pts), dtype=np.int64)
        self._blend(arr[:, 0], arr[:, 1], color, alpha)

    def arrow(self, x0, y0, x1, y1, color, width=2.0, head=9.0):
        self.line(x0, y0, x1, y1, color, width)
        ang = np.arctan2(y1 - y0, x1 - x0)
        for da in (2.6, -2.6):
            self.line(x1, y1, x1 + head * np.cos(ang + da), y1 + head * np.sin(ang + da), color, width)

    def text_size(self, s, scale=1):
        return len(s) * 6 * scale - scale, 8 * scale

    def text(self, x, y, s, color=(0, 0, 0), scale=1, halo=None):
        """Draw upper-cased text with its top-left at (x, y)."""
        s = s.upper()
        xs_all, ys_all = [], []
        for i, ch in enumerate(s):
            bits = _FONT.get(ch, _FONT[" "])
            for k, b in enumerate(bits):
                if b == "1":
                    gy, gx = divmod(k, 5)
                    for sy in range(scale):
                        for sx in range(scale):
                            xs_all.append(int(x) + (i * 6 + gx) * scale + sx)
                            ys_all.append(int(y) + gy * scale + sy)
        if not xs_all:
            return
        xs, ys = np.array(xs_all), np.array(ys_all)
        if halo is not None:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx or dy:
                        self._blend(ys + dy, xs + dx, halo)
        self._blend(ys, xs, color)

    def save(self, path):
        raw = b"".join(b"\x00" + self.px[r].tobytes() for r in range(self.h))

        def chunk(tag, data):
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        with open(path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
            f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0)))
            f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
            f.write(chunk(b"IEND", b""))
