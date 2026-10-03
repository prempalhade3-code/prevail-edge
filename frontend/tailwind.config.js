/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        prevail: {
          bg: "#09090b",
          panel: "#111827",
          accent: "#38bdf8",
          warm: "#f59e0b",
          ok: "#34d399",
        },
      },
    },
  },
  plugins: [],
};
