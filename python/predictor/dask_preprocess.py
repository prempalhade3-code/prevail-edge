"""Optional Dask-based preprocessing pipeline for large-scale trajectory datasets.

Note: Dask is strictly optional for offline data preprocessing (e.g. multi-gigabyte
T-Drive or GeoLife GPS logs) and is never loaded during real-time inference serving.
"""

import sys
from pathlib import Path
from typing import List, Optional


def preprocess_trajectories_dask(
    input_glob: str,
    output_parquet: str,
    edge_regions_path: Optional[str] = None,
):
    """Processes large partitioned GPS log files into mapped edge transitions using Dask."""
    try:
        import dask.dataframe as dd
    except ImportError:
        print(
            "Optional dependency 'dask' is not installed. "
            "Install with `pip install dask[dataframe]` to run distributed trajectory preprocessing.",
            file=sys.stderr,
        )
        return False

    print(f"Reading trajectory logs from: {input_glob}")
    # Example schema: [session_id, timestamp, latitude, longitude]
    df = dd.read_csv(
        input_glob,
        names=["session_id", "timestamp", "latitude", "longitude"],
        dtype={"session_id": "string", "timestamp": "int64", "latitude": "float64", "longitude": "float64"},
    )

    # Simple spatial partition mapper
    def _map_partition(partition):
        from python.mobility.region_mapper import RegionMapper
        mapper = RegionMapper(config_path=edge_regions_path)
        partition["edge_id"] = partition.apply(
            lambda row: mapper.get_edge_id(row["latitude"], row["longitude"]),
            axis=1,
        )
        return partition

    mapped = df.map_partitions(_map_partition)
    print(f"Exporting processed edge-labeled dataset to: {output_parquet}")
    mapped.to_parquet(output_parquet)
    return True


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Optional Dask Trajectory Preprocessor")
    parser.add_argument("--input", type=str, required=True, help="Input CSV file or glob pattern")
    parser.add_argument("--output", type=str, required=True, help="Output Parquet directory")
    parser.add_argument("--config", type=str, default=None, help="Path to edge-regions.json")
    args = parser.parse_args()

    preprocess_trajectories_dask(args.input, args.output, args.config)
