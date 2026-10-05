import { useEffect, useRef, useState } from "react";

export interface VehiclePose {
  lat: number;
  lon: number;
  heading: number;
  ready: boolean;
}

export function useSmoothedVehicle(lat?: number, lon?: number, heading?: number): VehiclePose {
  const hasFix = lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon);
  const target = useRef({ lat: lat ?? 0, lon: lon ?? 0, heading: heading ?? 0, ready: hasFix });
  const [pose, setPose] = useState<VehiclePose>(target.current);

  useEffect(() => {
    if (lat == null || lon == null) {
      target.current.ready = false;
      return;
    }
    target.current = { lat, lon, heading: heading ?? target.current.heading, ready: true };
  }, [lat, lon, heading]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPose((prev) => {
        const t = target.current;
        if (!t.ready) return { ...prev, ready: false };
        if (!prev.ready) return { ...t };
        const nlat = prev.lat + (t.lat - prev.lat) * 0.28;
        const nlon = prev.lon + (t.lon - prev.lon) * 0.28;
        let dh = t.heading - prev.heading;
        while (dh > 180) dh -= 360;
        while (dh < -180) dh += 360;
        return {
          lat: Math.abs(t.lat - nlat) < 0.000001 ? t.lat : nlat,
          lon: Math.abs(t.lon - nlon) < 0.000001 ? t.lon : nlon,
          heading: prev.heading + dh * 0.28,
          ready: true,
        };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return pose;
}
