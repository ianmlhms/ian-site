"""Block-packed grid codec "MBG1" for Lux Drive (Python encoder).

This is the format of scripts/mtb/codec.py, kept BIT IDENTICAL so the browser decoder
(pb/lux-drive/codec.js, a copy of the MTB one) reads it without changes - but the encoder is
vectorised: the MTB one loops over every node in Python, which takes minutes on a 15 M node grid
(the Lux Drive world), while this one is a handful of numpy passes.

A grid of float nodes (nz rows x nx columns) is quantised (q = round((h - h0) / step)), predicted
with the planar rule
    pred = left + up - upleft      (first row: left, first column: up, node (0,0): 0)
and the residuals are stored in 8x8 blocks: 4 bits "width" w (0..15) then hh*ww (64 in the
interior, fewer at the border) zigzag residuals of w bits each, least-significant bit first.

Layout (little endian):  'MBG1' | u16 nx | u16 nz | f32 step | f32 h0 | u8 block | u8 reserved | payload
"""
import struct

import numpy as np

MAGIC = b"MBG1"
BLOCK = 8
HEADER = struct.Struct("<4sHHffBB")
HEADER_BYTES = HEADER.size          # 18


def _predict(q):
    p = np.zeros_like(q)
    p[1:, 1:] = q[:-1, 1:] + q[1:, :-1] - q[:-1, :-1]
    p[0, 1:] = q[0, :-1]
    p[1:, 0] = q[:-1, 0]
    return p


def _bitlen(a):
    """Bit length of every element of a uint64 array (0 for 0)."""
    out = np.zeros(a.shape, dtype=np.int64)
    for k in range(63, -1, -1):
        m = (a >> np.uint64(k)) != 0
        out[m & (out == 0)] = k + 1
    return out


def encode(grid, step, h0=None):
    """float array [nz, nx] -> bytes.  Returns (blob, decoded float32 grid) so the caller bakes
    exactly what the browser will see."""
    grid = np.asarray(grid, dtype=np.float64)
    nz, nx = grid.shape
    if h0 is None:
        h0 = float(np.floor(grid.min()))
    q = np.round((grid - h0) / step).astype(np.int64)
    r = q - _predict(q)
    zz = ((r << 1) ^ (r >> 63)).astype(np.uint64)

    nbz = (nz + BLOCK - 1) // BLOCK
    nbx = (nx + BLOCK - 1) // BLOCK
    pad = np.zeros((nbz * BLOCK, nbx * BLOCK), dtype=np.uint64)
    pad[:nz, :nx] = zz

    # blocks in row-major order, each block's values in row-major order inside the block
    blocks = pad.reshape(nbz, BLOCK, nbx, BLOCK).transpose(0, 2, 1, 3).reshape(nbz * nbx, BLOCK * BLOCK)
    # the border blocks hold only the values that exist: the hh x ww sub-grid of the block, in
    # row-major order (a contiguous range would take the wrong slots on the right/bottom border)
    valid = np.zeros((nbz * nbx, BLOCK, BLOCK), dtype=bool)
    for by in range(nbz):
        hh = min(BLOCK, nz - by * BLOCK)
        for bx in range(nbx):
            ww = min(BLOCK, nx - bx * BLOCK)
            valid[by * nbx + bx, :hh, :ww] = True
    valid = valid.reshape(nbz * nbx, BLOCK * BLOCK)

    widths = np.where(valid, blocks, 0).max(axis=1)
    widths = _bitlen(widths)
    if widths.max(initial=0) > 15:
        bad = int(np.argmax(widths))
        raise ValueError("residual too large for the 4-bit width (%d bits) at block %d" % (widths[bad], bad))

    nvals = valid.sum(axis=1)
    bits_per_block = 4 + nvals * widths
    off = np.zeros(nbz * nbx + 1, dtype=np.int64)
    np.cumsum(bits_per_block, out=off[1:])
    total_bits = int(off[-1])

    rank = np.cumsum(valid, axis=1, dtype=np.int64) - 1
    pos = off[:-1, None] + 4 + rank * widths[:, None]

    bits = np.zeros(total_bits, dtype=np.uint8)
    # the 4-bit width of every block, LSB first
    for j in range(4):
        m = ((widths >> j) & 1) == 1
        if m.any():
            bits[off[:-1][m] + j] = 1
    # then the residual bits of every value
    for j in range(int(widths.max(initial=0))):
        m = valid & (widths[:, None] > j)
        if not m.any():
            continue
        bits[pos[m] + j] = ((blocks >> np.uint64(j)) & np.uint64(1))[m]
    payload = np.packbits(bits, bitorder="little").tobytes()

    blob = HEADER.pack(MAGIC, nx, nz, float(step), float(h0), BLOCK, 0) + payload
    # The browser reads `step` and `h0` back as float32 and computes Math.fround(h0 + q * step), so the
    # grid we return is computed with the ROUNDED header values: the checksum written into
    # terrain.json then matches the one the browser computes, bit for bit.
    h0f = float(np.float32(h0))
    stepf = float(np.float32(step))
    return blob, (h0f + q * stepf).astype(np.float32)


def decode(blob):
    """Reference decoder (slow); the browser has the fast one in pb/lux-drive/codec.js."""
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
    return (float(h0) + q * float(step)).astype(np.float32)


def decode_np(blob):
    """Vectorised decoder - the same bytes decode() reads, but in numpy passes.

    The reference decoder() above loops over every node in Python, which takes half an hour on the
    15 M node Lux Drive grid; this one takes a second.
    """
    magic, nx, nz, step, h0, block, _ = HEADER.unpack_from(blob, 0)
    if magic != MAGIC:
        raise ValueError("not an MBG1 grid")
    bits = np.unpackbits(np.frombuffer(blob[HEADER.size:], dtype=np.uint8), bitorder="little")
    nbz = (nz + block - 1) // BLOCK
    nbx = (nx + block - 1) // BLOCK
    widths = np.zeros(nbz * nbx, dtype=np.int64)
    offsets = np.zeros(nbz * nbx, dtype=np.int64)
    counts = np.zeros(nbz * nbx, dtype=np.int64)
    pos = 0
    for by in range(nbz):
        hh = min(BLOCK, nz - by * BLOCK)
        for bx in range(nbx):
            ww = min(BLOCK, nx - bx * BLOCK)
            b = by * nbx + bx
            widths[b] = int(bits[pos]) | (int(bits[pos + 1]) << 1) | (int(bits[pos + 2]) << 2) | (int(bits[pos + 3]) << 3)
            offsets[b] = pos
            counts[b] = hh * ww
            pos += 4 + hh * ww * int(widths[b])
    per_value_width = np.repeat(widths, counts)
    ranks = np.concatenate([np.arange(int(c)) for c in counts]) if len(counts) else np.zeros(0, dtype=np.int64)
    base = np.repeat(offsets, counts) + 4
    posv = base + ranks * per_value_width
    values = np.zeros(posv.size, dtype=np.int64)
    for j in range(int(widths.max(initial=0))):
        m = per_value_width > j
        values[m] |= bits[posv[m] + j].astype(np.int64) << j
    residual = (values >> 1) ^ -(values & 1)                      # un-zigzag
    # The bit stream is BLOCK major: the values of a block come first, and inside a block they
    # are row major (yy, xx).  Scatter them back into the grid.
    ww = np.repeat(np.array([min(BLOCK, nx - bx * BLOCK) for by in range(nbz) for bx in range(nbx)], dtype=np.int64), counts)
    blk = np.repeat(np.arange(nbz * nbx), counts)
    by = blk // nbx
    bx = blk % nbx
    gy = by * BLOCK + ranks // ww
    gx = bx * BLOCK + ranks % ww
    r2 = np.zeros(nz * nx, dtype=np.int64)
    r2[gy * nx + gx] = residual
    r2 = r2.reshape(nz, nx)
    # The planar predictor undoes with cumulative sums: the vertical difference d[j,i] = q[j,i] -
    # q[j-1,i] satisfies d[j,i] = d[j,i-1] + r[j,i] (so d is a running sum along the row), and
    # q[j,:] = q[0,:] + the running sum of d down the rows.  Row 0 has no row above it: its
    # prediction is the node to the left, so q[0,:] is a running sum of r[0,:].
    diff = np.cumsum(r2, axis=1)
    q = np.zeros((nz, nx), dtype=np.int64)
    q[0] = np.cumsum(r2[0])
    if nz > 1:
        q[1:] = q[0] + np.cumsum(diff[1:], axis=0)
    return (float(h0) + q * float(step)).astype(np.float32)
