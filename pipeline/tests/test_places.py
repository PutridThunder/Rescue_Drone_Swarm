"""Gathering places from OpenStreetMap: classification and capacity estimates."""

from rescue_eo import places


def test_classify_prefers_amenity_and_knows_stations():
    assert places.classify({"amenity": "school"}) == "school"
    assert places.classify({"public_transport": "station"}) == "station"
    assert places.classify({"amenity": "bench"}) is None


def test_capacity_from_osm_tag_wins():
    assert places.capacity_for("theatre", {"capacity": "640"}) == (640, "osm")


def test_capacity_known_venue_and_school_level():
    assert places.capacity_for("stadium", {"name": "Rogers Arena"}) == (18_900, "estimate")
    assert places.capacity_for("school", {"name": "Carson Graham Secondary"})[0] == 1_100
    assert places.capacity_for("school", {"name": "Ridgeway Elementary"})[0] == 350


def test_parse_uses_way_centres_and_skips_unknown():
    elements = [
        {"type": "node", "id": 1, "lat": 49.3, "lon": -123.0, "tags": {"amenity": "library", "name": "City Library"}},
        {"type": "way", "id": 2, "center": {"lat": 49.31, "lon": -123.01}, "tags": {"shop": "mall", "name": "Mall"}},
        {"type": "node", "id": 3, "lat": 49.3, "lon": -123.0, "tags": {"amenity": "bench"}},
    ]
    found = places.parse(elements)
    assert [p.id for p in found] == ["node/1", "way/2"]
    assert found[1].lat == 49.31
    assert set(places.to_json(found)[0]) >= {"id", "name", "kind", "capacity", "capacitySource"}
