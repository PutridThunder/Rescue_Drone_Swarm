"""Command line: build the Earth-observation layers and gathering places for one or all areas.

    python -m rescue_eo --area lonsdale
    python -m rescue_eo --all
    python -m rescue_eo --area lonsdale --only places
"""

from __future__ import annotations

import argparse
import dataclasses
import sys
import time

import numpy as np

from . import output, places
from .area import Area, all_area_ids, load_area
from .sources import dem, ghsl, sentinel2, worldcover

STEPS = ("places", "eo")
SATELLITE_SCALE = 2  # satellite.jpg has 2 x 2 pixels per 10 m cell
SCENE_DATES = "2024-05-01/2026-09-30"


def build_places(area: Area) -> None:
    try:
        found = places.fetch(area)
    except RuntimeError as err:  # keep the places.json already bundled
        print(f"  places: skipped, {err}; keeping the existing places.json")
        return
    output.write_places(area, places.to_json(found), places.SOURCE)
    print(f"  places: {len(found)} gathering places from OpenStreetMap")


def build_eo(area: Area) -> None:
    print("  elevation: Copernicus DEM GLO-30")
    elevation = dem.fetch(area)
    print("  land cover: ESA WorldCover")
    land = worldcover.fetch(area)
    print("  population: GHSL")
    people = ghsl.fetch(area)
    print("  imagery: Sentinel-2 (searching for a clear scene)")
    scene, _ = sentinel2.find_scene(area, SCENE_DATES)
    water_index = sentinel2.ndwi(area, scene)
    big = dataclasses.replace(area, width=area.width * SATELLITE_SCALE, height=area.height * SATELLITE_SCALE)
    output.write_satellite(area, sentinel2.true_colour(big, scene))

    output.write_eo(
        area,
        {
            "elevation": (np.nan_to_num(elevation, nan=0.0), 1),
            "landCover": (land, 0),
            "population": (people, 2),
            "ndwi": (np.round(water_index * 100), 0),  # percent, -100..100
        },
        [dem.SOURCE, worldcover.SOURCE, ghsl.SOURCE, {**sentinel2.SOURCE, "scene": scene.id, "date": scene.date, "cloudCover": scene.cloud_cover}],
        {"satellite": "satellite.jpg", "satelliteScale": SATELLITE_SCALE},
    )
    covered = {code: int((land == code).sum()) for code in worldcover.CLASSES if (land == code).any()}
    top = ", ".join(f"{worldcover.CLASSES[c]} {n * 100 / land.size:.0f}%" for c, n in sorted(covered.items(), key=lambda kv: -kv[1])[:4])
    print(f"  wrote eo.json + satellite.jpg: {people.sum():,.0f} residents (GHSL); land: {top}; scene {scene.date} ({scene.cloud_cover:.1f}% cloud)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rescue_eo", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--area", help="area id(s), e.g. lonsdale or metrotown,surrey-centre")
    target.add_argument("--all", action="store_true", help="every area in public/areas/index.json")
    parser.add_argument("--only", choices=STEPS, help="run a single step")
    args = parser.parse_args(argv)

    ids = all_area_ids() if args.all else args.area.split(",")
    for area_id in ids:
        area = load_area(area_id)
        print(f"{area.name} ({area.width} x {area.height} cells)")
        started = time.time()
        if args.only in (None, "places"):
            build_places(area)
        if args.only in (None, "eo"):
            build_eo(area)
        print(f"  done in {time.time() - started:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
