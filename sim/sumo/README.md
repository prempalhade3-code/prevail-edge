# SUMO integration (Phase 9 — full traffic simulation)

PREVAIL uses **SUMO** for research-grade road traffic (per master plan).  
The current **road_simulator.py** provides immediate realistic drive without SUMO installed.

## When SUMO is installed

```bash
# 1. Generate network + route (example)
sumo-netconvert --osm-files bangalore-extract.osm -o sim/sumo/corridor.net.xml

# 2. Run simulation, export FCD trace
sumo -c sim/sumo/corridor.sumocfg --fcd-output sim/output/trace.fcd.xml

# 3. Convert to PREVAIL JSONL
python -m python.mobility.sumo_adapter sim/output/trace.fcd.xml sim/fixtures/sumo-trace.jsonl

# 4. Replay or feed runtime
PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 python sim/vehicle/replayer.py
```

## Files to add (next iteration)

- `corridor.net.xml` — road network
- `corridor.rou.xml` — vehicle routes + traffic demand
- `corridor.sumocfg` — simulation config

**CARLA** (3D) is optional presentation-only per plan — not on critical path.
