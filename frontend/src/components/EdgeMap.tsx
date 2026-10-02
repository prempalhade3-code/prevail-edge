import { Circle, MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { SystemSnapshot } from "../types";

function roleColor(role: string): string {
  if (role === "AUTHORITATIVE") return "#10b981";
  if (role === "WARM_SHADOW") return "#f59e0b";
  return "#64748b";
}

export function EdgeMap({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const center: [number, number] = snapshot?.topology[0]
    ? [snapshot.topology[0].latitude, snapshot.topology[0].longitude]
    : [12.9716, 77.5946];

  const vehiclePosition: [number, number] | null =
    snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null
      ? [snapshot.vehicle_latitude, snapshot.vehicle_longitude]
      : null;

  return (
    <div className="h-80 w-full rounded-lg overflow-hidden border border-slate-700">
      <MapContainer center={center} zoom={14} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {snapshot?.topology.map((node) => (
          <Circle
            key={node.edge_id}
            center={[node.latitude, node.longitude]}
            radius={280}
            pathOptions={{
              color: roleColor(node.role),
              fillColor: roleColor(node.role),
              fillOpacity: 0.35,
            }}
          >
            <Popup>
              <strong>{node.edge_id}</strong>
              <br />
              Role: {node.role}
              {node.sync_ratio != null && (
                <>
                  <br />
                  Sync: {(node.sync_ratio * 100).toFixed(0)}%
                </>
              )}
            </Popup>
          </Circle>
        ))}
        {vehiclePosition && (
          <Marker position={vehiclePosition}>
            <Popup>Vehicle (live trajectory)</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
