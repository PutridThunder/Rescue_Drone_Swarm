"""Tile naming for the global datasets: a wrong tile silently gives an empty layer."""

from rescue_eo.area import Area
from rescue_eo.raster import degree_tiles
from rescue_eo.sources import dem, ghsl

LONSDALE = Area("lonsdale", "Lonsdale", 49.30, -123.10, 49.33, -123.06, 254, 211, 10)


def test_dem_tile_url_uses_south_west_corner():
    assert "Copernicus_DSM_COG_10_N49_00_W124_00_DEM" in dem.tile_url(49, -124)


def test_area_inside_one_degree_tile():
    assert degree_tiles(LONSDALE, 1) == [(49, -124)]


def test_area_crossing_a_tile_edge_needs_both_tiles():
    edge = Area("edge", "Edge", 48.99, -123.01, 49.01, -122.99, 10, 10, 10)
    assert sorted(degree_tiles(edge, 1)) == [(48, -124), (48, -123), (49, -124), (49, -123)]


def test_ghsl_vancouver_tile():
    # GHSL tiles are offset from round degrees (rows start at 89.0996 N), so Metro Vancouver is in
    # row 4 even though 89.1 - 49.3 is just under 40 degrees.
    assert ghsl.tile_id(49.31, -123.08) == "R4_C6"
    assert ghsl.tile_id(49.10, -122.85) == "R4_C6"
