"""Download official T-Drive and GeoLife traces for GRU training.

Refuses to synthesize. Sources are the Microsoft Research releases (or
byte-identical public mirrors of those releases).
"""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEST = Path(__file__).resolve().parent / "data" / "official"

# Official Microsoft Research T-Drive daily dumps (taxi_id,datetime,lon,lat).
TDRIVE_ZIP_URLS = [
    "https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/06.zip",
    "https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/02.zip",
    "https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/03.zip",
    "https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/07.zip",
]

# Official GeoLife Trajectories 1.3 (Microsoft Research) plus documented mirrors.
GEOLIFE_URLS = [
    "https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/Geolife-Trajectories-1.3.zip",
    "https://download.microsoft.com/download/F/9/8/F9830CB1-AE1B-4D56-A1F0-758A7AC9565E/Geolife%20Trajectories%201.3.zip",
    "https://www.microsoft.com/en-us/research/uploads/prod/2016/02/Geolife-Trajectories-1.3.zip",
    "https://download.microsoft.com/download/f/4/8/f4894aa5-fdbc-481e-9285-d5f8c4c4f039/Geolife%20Trajectories%201.3.zip",
    "https://download.microsoft.com/download/F/4/8/F4894AA5-FDBC-481E-9285-D5C24EC3F4DE/Geolife%20Trajectories%201.3.zip",
    "https://archive.org/download/geolife-trajectories-1.3/Geolife%20Trajectories%201.3.zip",
    "https://archive.org/download/geolife_gps_trajectories/Geolife%20Trajectories%201.3.zip",
]

GEOLIFE_PLT_URLS = [
    "https://raw.githubusercontent.com/yosefzaidan/geolife-gps-data/master/Data/000/Trajectory/20081023025304.plt",
    "https://raw.githubusercontent.com/yosefzaidan/geolife-gps-data/master/Data/001/Trajectory/20081023055305.plt",
    "https://raw.githubusercontent.com/datasciencedojo/tutorials/master/Geolife%20Trajectories%201.3/Data/000/Trajectory/20081023025304.plt",
    "https://media.githubusercontent.com/media/yosefzaidan/geolife-gps-data/master/Data/000/Trajectory/20081023025304.plt",
]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, dest: Path, timeout: int = 60) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "prevail-trainer/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            with dest.open("wb") as fh:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    fh.write(chunk)
        return dest.stat().st_size > 32
    except Exception as exc:
        print(f"[official] download failed {url}: {exc}")
        if dest.exists() and dest.stat().st_size == 0:
            dest.unlink()
        return False


def _extract_tdrive_zip(blob: bytes, dest: Path, limit: int = 40) -> List[Path]:
    written: List[Path] = []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for info in zf.infolist():
            name = Path(info.filename).name
            if not name.endswith(".txt") or info.file_size < 64:
                continue
            out = dest / name
            out.write_bytes(zf.read(info))
            written.append(out)
            if len(written) >= limit:
                break
    return written


def download_tdrive(dest: Path = DEST / "tdrive") -> List[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    existing = sorted(p for p in dest.glob("*.txt") if p.stat().st_size > 32)
    if len(existing) >= 8:
        return existing
    files: List[Path] = list(existing)
    for url in TDRIVE_ZIP_URLS:
        archive = dest / Path(url).name
        if archive.exists() or _download(url, archive, timeout=180):
            extracted = _extract_tdrive_zip(archive.read_bytes(), dest)
            files.extend(extracted)
            print(f"[official] T-Drive {url} -> {len(extracted)} taxi files")
            if len(files) >= 8:
                break
    unique = []
    seen = set()
    for path in files:
        if path.resolve() in seen:
            continue
        seen.add(path.resolve())
        unique.append(path)
    if not unique:
        raise RuntimeError("official T-Drive traces could not be downloaded")
    return unique


def _extract_plt_from_path(archive: Path, dest: Path, limit: int = 40) -> List[Path]:
    written: List[Path] = []
    try:
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                if info.filename.lower().endswith(".plt") and info.file_size > 64:
                    out = dest / Path(info.filename).name
                    out.write_bytes(zf.read(info))
                    written.append(out)
                    if len(written) >= limit:
                        break
    except zipfile.BadZipFile:
        return written
    return written


def _extract_plt(blob: bytes, dest: Path) -> List[Path]:
    written: List[Path] = []
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            for info in zf.infolist():
                if info.filename.lower().endswith(".plt") and info.file_size > 64:
                    out = dest / Path(info.filename).name
                    out.write_bytes(zf.read(info))
                    written.append(out)
                    if len(written) >= 40:
                        break
        return written
    try:
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:*") as tf:
            for member in tf.getmembers():
                if member.name.lower().endswith(".plt") and member.size > 64:
                    extracted = tf.extractfile(member)
                    if extracted is None:
                        continue
                    out = dest / Path(member.name).name
                    out.write_bytes(extracted.read())
                    written.append(out)
                    if len(written) >= 40:
                        break
    except tarfile.TarError:
        pass
    return written


def download_geolife(dest: Path = DEST / "geolife") -> List[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    existing = sorted(dest.glob("*.plt"))
    if len(existing) >= 2:
        return existing
    for url in GEOLIFE_URLS:
        archive = dest / "geolife-official.zip"
        if _download(url, archive, timeout=300):
            if archive.stat().st_size > 8 * 1024 * 1024:
                plts = _extract_plt_from_path(archive, dest)
            else:
                plts = _extract_plt(archive.read_bytes(), dest)
            if plts:
                print(f"[official] GeoLife extracted {len(plts)} plt files")
                return plts
    files: List[Path] = []
    for idx, url in enumerate(GEOLIFE_PLT_URLS):
        path = dest / f"geolife_{idx:02d}.plt"
        if path.exists() and path.stat().st_size > 64:
            files.append(path)
            continue
        if _download(url, path):
            files.append(path)
    if not files:
        raise RuntimeError("official GeoLife traces could not be downloaded")
    return files


def write_manifest(tdrive: Iterable[Path], geolife: Iterable[Path], dest: Path = DEST) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    records = []
    for kind, paths in (("tdrive", tdrive), ("geolife", geolife)):
        for path in paths:
            records.append({
                "dataset": kind,
                "path": str(path.relative_to(ROOT)) if str(path).startswith(str(ROOT)) else str(path),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            })
    manifest = dest / "manifest.json"
    manifest.write_text(json.dumps({"files": records, "source": "official"}, indent=2), encoding="utf-8")
    return manifest


def ensure_official() -> Tuple[List[Path], List[Path], Path]:
    tdrive = download_tdrive()
    try:
        geolife = download_geolife()
    except RuntimeError as exc:
        print(f"[official] GeoLife optional download failed: {exc}")
        geolife = []
    if not tdrive and not geolife:
        raise RuntimeError("official T-Drive/GeoLife traces could not be downloaded")
    manifest = write_manifest(tdrive, geolife)
    return tdrive, geolife, manifest


def main() -> int:
    tdrive, geolife, manifest = ensure_official()
    print(f"[official] tdrive={len(tdrive)} geolife={len(geolife)} manifest={manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
