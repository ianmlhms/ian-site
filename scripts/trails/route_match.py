#!/usr/bin/env python3
"""Decide whether two route lines are the same circuit, by how much they overlap.

Centre-and-length comparison cannot do this job. Oetrange and Moutfort sit
2.7 km apart with similar lengths and are different circuits; meanwhile the
same loop can shift its centre by 2 km when one village end is rerouted. Both
cases are indistinguishable from a centroid.

Overlap separates them cleanly: sample both routes at a fixed spacing, then
ask what share of each one runs within SAME_ROUTE_M of the other. Real pairs
score 90-100%, rerouted-but-same pairs 55-90%, neighbouring circuits under 50%.

The score is the *smaller* of the two directions, so a short circuit that runs
entirely along one leg of a long one does not read as a match.
"""
from __future__ import annotations

import math

SAMPLE_STEP_M = 60.0   # spacing of the sampled points along each route
SAME_ROUTE_M = 150.0   # a point counts as "on" the other route within this
CELL_DEG = 0.003       # ≈ 215 m north-south: the spatial index's cell size
EARTH_R = 6371000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def _sample(lines: list) -> list:
    """[[lon, lat], ...] segments → evenly spaced (lat, lon) points.

    Even spacing is what makes the score length-weighted: raw vertices cluster
    in bends, so a dense hairpin would otherwise outvote a long straight.
    """
    points = []
    for coords in lines:
        for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
            steps = max(1, int(haversine_m(lat1, lon1, lat2, lon2) // SAMPLE_STEP_M))
            points.extend(
                (lat1 + (lat2 - lat1) * i / steps, lon1 + (lon2 - lon1) * i / steps)
                for i in range(steps)
            )
        if coords:
            points.append((coords[-1][1], coords[-1][0]))
    return points


def shape_of(lines: list) -> dict:
    """Everything needed to compare one route: its points, a grid and a centre."""
    points = _sample(lines)
    if not points:
        raise ValueError("route has no usable geometry")
    grid: dict = {}
    for lat, lon in points:
        grid.setdefault((int(lat / CELL_DEG), int(lon / CELL_DEG)), []).append((lat, lon))
    lats = [lat for lat, _ in points]
    lons = [lon for _, lon in points]
    return {
        "points": points,
        "grid": grid,
        "center": ((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2),
    }


def _is_on_route(lat: float, lon: float, grid: dict) -> bool:
    cell_y, cell_x = int(lat / CELL_DEG), int(lon / CELL_DEG)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for other_lat, other_lon in grid.get((cell_y + dy, cell_x + dx), ()):
                if haversine_m(lat, lon, other_lat, other_lon) <= SAME_ROUTE_M:
                    return True
    return False


def _covered(points: list, grid: dict) -> float:
    on_route = sum(1 for lat, lon in points if _is_on_route(lat, lon, grid))
    return on_route / len(points)


def overlap(first: dict, second: dict) -> float:
    """0.0-1.0. The smaller of the two coverage directions; 0.0 when far apart."""
    # Nothing 6 km apart can overlap, and skipping those keeps this O(n) in
    # practice rather than comparing all 154 × 105 pairs point by point.
    if haversine_m(*first["center"], *second["center"]) > 6000:
        return 0.0
    return min(_covered(first["points"], second["grid"]),
               _covered(second["points"], first["grid"]))
