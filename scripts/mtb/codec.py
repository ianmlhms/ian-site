"""Block-packed grid codec "MBG1" (Python encoder / reference decoder; the browser decoder is pb/mtb/codec.js).

A grid of float nodes (nz rows x nx columns) is quantised (q = round((h - h0) / step)), predicted with the planar rule
    pred = left + up - upleft      (first row: left, first column: up, node (0,0): 0)
and the residuals are stored in 8x8 blocks: 4 bits "width" w (0..15) then 64 (or fewer, at the border) zigzag residuals of w bits each,
least-significant bit first.  Smooth terrain costs 2-3 bits per node; a 6 km x 4.6 km DTM at 2 m (7.1 M nodes) is about 2.2 MB.

Layout (little endian):  'MBG1' | u16 nx | u16 nz | f32 step | f32 h0 | u8 block | u8 reserved | payload (bit stream)
"""
import struct

import numpy as np

MAGIC = b"MBG1"
BLOCK = 8
HEADER = struct.Struct("<4sHHffBB")


def _predict(q):
    p = np.zeros_like(q)
    p[1:, 1:] = q[:-1, 1:] + q[1:, :-1] - q[:-1, :-1]
    p[0, 1:] = q[0, :-1]
    p[1:, 0] = q[:-1, 0]
    return p


def encode(grid, step, h0=None):
    """float array [nz, nx] -> bytes.  Returns (blob, decoded float32 grid) so the caller bakes exactly what the browser will see."""
    grid = np.asarray(grid, dtype=np.float64)
    nz, nx = grid.shape
    if h0 is None:
        h0 = float(np.floor(grid.min()))
    q = np.round((grid - h0) / step).astype(np.int64)
    r = q - _predict(q)
    zz = ((r << 1) ^ (r >> 63)).astype(np.uint64)
    bits_out = []          # list of (value, nbits) packed below in numpy for speed
    # per block widths
    widths = []
    chunks = []
    for by in range(0, nz, BLOCK):
        for bx in range(0, nx, BLOCK):
            blk = zz[by:by + BLOCK, bx:bx + BLOCK].ravel()
            m = int(blk.max()) if blk.size else 0
            w = m.bit_length()
            if w > 15:
                raise ValueError("residual too large for the 4-bit width (%d bits) at block %d,%d" % (w, bx, by))
            widths.append(w)
            chunks.append(blk)
    # bit packing: build a Python big bit list per block is slow; pack with numpy per block
    out = bytearray()
    acc = 0
    nacc = 0
    for w, blk in zip(widths, chunks):
        acc |= w << nacc
        nacc += 4
        if w:
            # pack len(blk) values of w bits
            vals = blk.astype(object)
            for v in vals.tolist():
                acc |= v << nacc
                nacc += w
        while nacc >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            nacc -= 8
    if nacc:
        out.append(acc & 0xFF)
    blob = HEADER.pack(MAGIC, nx, nz, float(step), float(h0), BLOCK, 0) + bytes(out)
    return blob, (h0 + q * step).astype(np.float32)


def decode(blob):
    magic, nx, nz, step, h0, block, _ = HEADER.unpack_from(blob, 0)
    if magic != MAGIC:
        raise ValueError("not an MBG1 grid")
    data = blob[HEADER.size:]
    big = int.from_bytes(data, "little")
    pos = 0
    q = np.zeros((nz, nx), dtype=np.int64)
    for by in range(0, nz, block):
        for bx in range(0, nx, block):
            w = (big >> pos) & 0xF
            pos += 4
            hh = min(block, nz - by)
            ww = min(block, nx - bx)
            for yy in range(hh):
                for xx in range(ww):
                    v = (big >> pos) & ((1 << w) - 1) if w else 0
                    pos += w
                    r = (v >> 1) ^ -(v & 1)
                    y, x = by + yy, bx + xx
                    if y == 0 and x == 0:
                        p = 0
                    elif y == 0:
                        p = q[y, x - 1]
                    elif x == 0:
                        p = q[y - 1, x]
                    else:
                        p = q[y, x - 1] + q[y - 1, x] - q[y - 1, x - 1]
                    q[y, x] = p + r
    return (h0 + q * step).astype(np.float32)
