import { useEffect, useState } from "react";
import { CITIES, type City } from "../data/cities";
import { apiGet } from "../lib/api";

export function useGeoCities(): City[] {
  const [cities, setCities] = useState<City[]>(CITIES);

  useEffect(() => {
    void apiGet<{ cities?: City[] }>("/v1/geo", 6000)
      .then((geo) => {
        if (Array.isArray(geo.cities) && geo.cities.length) {
          setCities(geo.cities.filter((city) => city.id && city.name));
        }
      })
      .catch(() => undefined);
  }, []);

  return cities;
}
