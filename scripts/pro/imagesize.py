"""Read pixel dimensions from WebP, PNG, and JPEG headers without dependencies.

The generator needs only image dimensions, so this deliberately avoids image
decoding libraries. Unsupported, truncated, and missing files return ``None``
so callers can safely omit HTML dimension attributes instead of guessing.
"""
from __future__ import annotations

from pathlib import Path


def image_size(path: Path) -> tuple[int, int] | None:
    """Return an image's (width, height), or None when its header is invalid."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return _png_size(data)
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return _webp_size(data)
    if data.startswith(b"\xff\xd8"):
        return _jpeg_size(data)
    return None


def _valid_size(width: int, height: int) -> tuple[int, int] | None:
    return (width, height) if width > 0 and height > 0 else None


def _png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    return _valid_size(int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"))


def _webp_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 20:
        return None
    end = min(len(data), int.from_bytes(data[4:8], "little") + 8)
    offset = 12
    while offset + 8 <= end:
        chunk = data[offset:offset + 4]
        length = int.from_bytes(data[offset + 4:offset + 8], "little")
        payload_start = offset + 8
        payload_end = payload_start + length
        if payload_end > end:
            return None
        payload = data[payload_start:payload_end]
        if chunk == b"VP8 ":
            return _vp8_size(payload)
        if chunk == b"VP8L":
            return _vp8l_size(payload)
        if chunk == b"VP8X":
            return _vp8x_size(payload)
        offset = payload_end + (length % 2)
    return None


def _vp8_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10 or data[3:6] != b"\x9d\x01\x2a":
        return None
    return _valid_size(int.from_bytes(data[6:8], "little") & 0x3FFF, int.from_bytes(data[8:10], "little") & 0x3FFF)


def _vp8l_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 5 or data[0] != 0x2F:
        return None
    bits = int.from_bytes(data[1:5], "little")
    return _valid_size((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)


def _vp8x_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10:
        return None
    return _valid_size(int.from_bytes(data[4:7], "little") + 1, int.from_bytes(data[7:10], "little") + 1)


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    start_of_frame = frozenset({
        0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
        0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
    })
    offset = 2
    while offset < len(data):
        while offset < len(data) and data[offset] != 0xFF:
            offset += 1
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            return None
        marker = data[offset]
        offset += 1
        if marker in (0x00, 0x01, 0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            return None
        length = int.from_bytes(data[offset:offset + 2], "big")
        if length < 2 or offset + length > len(data):
            return None
        if marker in start_of_frame:
            if length < 8:
                return None
            height = int.from_bytes(data[offset + 3:offset + 5], "big")
            width = int.from_bytes(data[offset + 5:offset + 7], "big")
            return _valid_size(width, height)
        offset += length
    return None
