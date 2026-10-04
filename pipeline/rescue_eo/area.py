"""An area's simulation grid, read from public/areas/<id>/world.json."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from rasterio.transform import Affine, from_bounds

REPO = Path(__file__).resolve().parents[2]
AREAS_DIR = REPO / "public" / "areas"
CACHE_DIR = REPO / ".cache" / "eo"
AREA_ID = re.compile(r"^[a-z0-9-]{1,40}$")


@dataclass(frozen=True)
class Area:
    """A rectangular area in lat/lon, divided into `width` x `height` cells (row 0 = north)."""

    id: str
    name: str
    south: float
    west: float
    north: float
    east: float
    width: int
    height: int
    cell_size_m: float

    @property
    def folder(self) -> Path:
        return AREAS_DIR / self.id

    @property
    def transform(self) -> Affine:
        """Pixel -> lon/lat transform of the grid (EPSG:4326, north-up)."""
        return from_bounds(self.west, self.south, self.east, self.north, self.width, self.height)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.height, self.width)


def load_area(area_id: str) -> Area:
    if not AREA_ID.match(area_id):
        raise ValueError(f"invalid area id: {area_id!r}")
    world = json.loads((AREAS_DIR / area_id / "world.json").read_text())
    meta = world["meta"]
    south, west, north, east = meta["bbox"]
    return Area(area_id, meta["name"], south, west, north, east, meta["width"], meta["height"], meta["cellSizeM"])


def all_area_ids() -> list[str]:
    index = json.loads((AREAS_DIR / "index.json").read_text())
    return [a["id"] for a in index["areas"]]
