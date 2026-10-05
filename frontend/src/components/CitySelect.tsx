import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CITIES, type City } from "../data/cities";

export function CitySelect({
  label,
  value,
  onChange,
  cities = CITIES,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  cities?: City[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLLabelElement>(null);
  const [menu, setMenu] = useState({ top: 0, left: 0, width: 240 });
  const selected = cities.find((city) => city.id === value);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter((city) => city.name.toLowerCase().includes(needle));
  }, [cities, query]);

  useEffect(() => {
    if (!open || !box.current) return;
    const place = () => {
      const rect = box.current!.getBoundingClientRect();
      setMenu({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 240) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <label ref={box} className="relative min-w-[220px]">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        value={open ? query : selected?.name ?? ""}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        placeholder="search city"
        className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-blue-500"
      />
      {open &&
        createPortal(
          <ul
            style={{ top: menu.top, left: menu.left, width: menu.width }}
            className="fixed z-[4000] max-h-64 overflow-auto rounded-xl border border-line bg-white py-1 shadow-float"
          >
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matching city</li>}
            {matches.map((city) => (
              <li key={city.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(city.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left text-sm ${
                    city.id === value ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  {city.name}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </label>
  );
}
