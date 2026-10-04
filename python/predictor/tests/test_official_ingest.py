"""Official T-Drive / GeoLife parsers map onto the PREVAIL region graph."""

from pathlib import Path

from python.predictor.ingest_gps import (
    featured_from_tdrive,
    load_official_sequences,
    project_beijing_to_corridor,
    sequences_from_geolife_plt,
    sequences_from_tdrive,
)


def test_tdrive_official_format(tmp_path: Path):
    path = tmp_path / "1.txt"
    path.write_text(
        "1,2008-02-02 15:36:08,116.51172,39.92123\n"
        "1,2008-02-02 15:46:08,116.61172,40.02123\n"
        "1,2008-02-02 15:56:08,116.65172,40.10123\n",
        encoding="utf-8",
    )
    seqs = sequences_from_tdrive(path)
    assert seqs
    assert all(edge.startswith("edge-") for seq in seqs for edge in seq)
    featured = featured_from_tdrive(path)
    assert featured
    edge, speed, heading = featured[0][0]
    assert edge.startswith("edge-")
    assert speed >= 0.0
    assert 0.0 <= heading <= 360.0


def test_geolife_plt_official_format(tmp_path: Path):
    path = tmp_path / "user.plt"
    path.write_text(
        "Geolife trajectory\nWGS 84\nAltitude is in Feet\nReserved 3\n0\n0\n"
        "39.92123,116.51172,0,492,39745.123,2008-10-23,02:53:04\n"
        "40.02123,116.61172,0,492,39745.124,2008-10-23,02:54:04\n"
        "40.10123,116.65172,0,492,39745.125,2008-10-23,02:55:04\n",
        encoding="utf-8",
    )
    seqs = sequences_from_geolife_plt(path)
    assert seqs and len(seqs[0]) >= 2


def test_beijing_projects_into_corridor():
    lat, lon = project_beijing_to_corridor(39.92, 116.45)
    assert 12.90 < lat < 12.97
    assert 77.65 < lon < 77.72


def test_load_official_if_present():
    official = Path(__file__).resolve().parents[1] / "data" / "official"
    if not (official / "tdrive").exists() and not (official / "geolife").exists():
        return
    seqs = load_official_sequences(official)
    assert isinstance(seqs, list)
