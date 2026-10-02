# PREVAIL Simulation Engine Architecture

## Decision: CARLA on Unreal Engine

| Option | Verdict | Reason |
|--------|---------|--------|
| **Three.js / browser WebGL** | Rejected | Cannot deliver vehicle physics, traffic AI, PBR lighting, or game-scale worlds. |
| **Unity** | Secondary | Good Mac support but weaker AD/traffic research ecosystem vs CARLA. |
| **Pure Unreal Engine 5** | Overkill | Maximum visuals but no built-in traffic/AD stack; months of custom work. |
| **CARLA + Unreal** | **Selected** | Unreal rendering + purpose-built vehicle physics, Traffic Manager, Python API, sensor stack, industry standard for AD/ITS research. |
| **SUMO + CARLA** | Phase 2 | SUMO for macro traffic; CARLA for 3D presentation (official co-simulation exists). |

CARLA **is** Unreal Engine under the hood (UE 4.26). We use CARLA rather than raw UE because it provides vehicles, traffic, maps, and Python control out of the box.

## System Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1 — AUTHORITY (existing, unchanged)                       │
│  road_simulator.py → Rust runtime :8090                          │
│  Edge handoffs, prediction, shadows, trajectory ingest           │
└────────────────────────────▲─────────────────────────────────────┘
                             │ HTTP /v1/snapshot, /v1/trajectory
┌────────────────────────────┴─────────────────────────────────────┐
│  LAYER 2 — SIMULATION ENGINE (NEW)                               │
│  CARLA Server (Unreal) :2000                                     │
│  • Town10HD urban environment                                    │
│  • Hero vehicle + driver walker                                  │
│  • Traffic Manager (realistic NPC traffic)                       │
│  • Edge infrastructure props (towers, cabinets, antennas)        │
│  • Chase + hood RGB cameras                                      │
│  sim/carla/prevail_bridge.py :8765                               │
│  • Geo anchor: Bangalore corridor ↔ CARLA world coords           │
│  • Sync hero/traffic/edges from PREVAIL snapshot                 │
│  • Stream JPEG frames + state via WebSocket                      │
└────────────────────────────▲─────────────────────────────────────┘
                             │ WS /ws/sim  HTTP /v1/sim/*
┌────────────────────────────┴─────────────────────────────────────┐
│  LAYER 3 — WEB APPLICATION (control + side map only)             │
│  FastAPI backend :8000                                           │
│  • Proxies engine stream to browser                              │
│  • Side minimap (Leaflet) synced via same /ws/live snapshot      │
│  • PREVAIL panels (prediction, shadows, timeline)                │
│  React frontend — EngineViewport shows CARLA video, NOT WebGL    │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. `road_simulator.py` posts GPS trajectory → runtime (5 Hz).
2. Runtime updates authority, edges, traffic, trail in snapshot.
3. `prevail_bridge.py` polls snapshot, maps lat/lon → CARLA transforms.
4. Bridge sets hero vehicle transform, syncs traffic actors, updates edge props.
5. CARLA RGB chase camera captures frame → JPEG → WebSocket.
6. Browser `EngineViewport` renders `<img>` / canvas from engine stream.
7. Side `MinimapPanel` uses same snapshot WebSocket (geographic view).

## Coordinate Mapping

Bangalore corridor anchored to CARLA **Town10HD** spawn region:

- Geo anchor: `(12.9716, 77.5946)` ↔ CARLA `(-104.5, 44.3)` meters
- Linear projection (local tangent plane), scale ×100 for UE centimeters
- Heading: PREVAIL `vehicle_heading` → CARLA `Rotation.yaw`

Custom OpenDRIVE map from `bangalore-corridor.geojson` is Phase 2 (SUMO netconvert → CARLA road import).

## Edge Server Representation

Physical props spawned in CARLA (not UI icons):

- `static.prop.streetbarrier` + `static.prop.trafficcone` stacks
- Custom assembly: platform mesh + vertical pole + emissive point light
- Color/state from PREVAIL topology role (AUTHORITATIVE / WARM_SHADOW / IDLE)

## Local Run Requirements

| Component | Platform | Notes |
|-----------|----------|-------|
| CARLA 0.9.15+ | **Linux / Windows + NVIDIA GPU** | Native UE server |
| CARLA on macOS | Not supported natively | Use Linux VM, Docker+NVIDIA, or remote GPU box |
| prevail_bridge | Linux/Mac/Win | Python 3.10+, `carla` egg from CARLA release |
| PREVAIL stack | Mac OK | runtime + backend + road_sim |

### Start order

```bash
# 1. CARLA server (Linux/GPU machine)
./CarlaUE4.sh -prefernvidia -quality-level=Epic

# 2. PREVAIL authority stack
scripts/run-prevail-core.sh

# 3. CARLA bridge
python sim/carla/prevail_bridge.py

# 4. Browser
open http://127.0.0.1:8000
```

Or: `docker compose -f docker-compose.carla.yml up` (Linux + nvidia-container-toolkit).

## Mac Development Workflow

Run PREVAIL core locally on Mac. Point bridge at remote CARLA:

```bash
export CARLA_HOST=192.168.1.50
export CARLA_PORT=2000
python sim/carla/prevail_bridge.py
```

Web UI shows engine stream when connected; side map + PREVAIL panels work without CARLA.
