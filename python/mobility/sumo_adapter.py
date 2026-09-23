import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Dict, Any, Optional
from .region_mapper import RegionMapper


class SUMOAdapter:
    """Converts SUMO FCD (Floating Car Data) XML output traces to PREVAIL TrajectorySample JSON lines."""

    def __init__(self, region_mapper: Optional[RegionMapper] = None):
        self.mapper = region_mapper or RegionMapper()

    def parse_fcd_xml(self, xml_file_path: str, session_id: str = "sumo-sim-01") -> List[Dict[str, Any]]:
        """
        Parses a SUMO FCD export XML file and returns a list of TrajectorySample dicts.
        """
        path = Path(xml_file_path)
        if not path.exists():
            raise FileNotFoundError(f"SUMO XML export file not found: {xml_file_path}")

        tree = ET.parse(path)
        root = tree.getroot()

        trajectory_samples = []

        for timestep in root.findall("timestep"):
            time_sec = float(timestep.attrib.get("time", 0.0))
            timestamp_ms = int(time_sec * 1000)

            for vehicle in timestep.findall("vehicle"):
                veh_id = vehicle.attrib.get("id", session_id)
                lat = float(vehicle.attrib.get("lat", vehicle.attrib.get("y", 0.0)))
                lon = float(vehicle.attrib.get("lon", vehicle.attrib.get("x", 0.0)))
                speed = float(vehicle.attrib.get("speed", 0.0))
                heading = float(vehicle.attrib.get("angle", 0.0))

                edge_id = self.mapper.get_edge_id(lat, lon)

                sample = {
                    "session_id": veh_id if veh_id else session_id,
                    "timestamp_ms": timestamp_ms,
                    "latitude": lat,
                    "longitude": lon,
                    "speed_mps": round(speed, 2),
                    "edge_id": edge_id,
                    "heading_deg": round(heading, 2),
                }
                trajectory_samples.append(sample)

        return trajectory_samples

    def convert_to_jsonl(self, xml_file_path: str, output_jsonl_path: str, session_id: str = "sumo-sim-01"):
        """Converts SUMO FCD export file to a JSONL file."""
        samples = self.parse_fcd_xml(xml_file_path, session_id=session_id)
        with open(output_jsonl_path, "w", encoding="utf-8") as f:
            for sample in samples:
                f.write(json.dumps(sample) + "\n")
