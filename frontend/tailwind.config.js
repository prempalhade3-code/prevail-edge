/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        prevail: {
          bg: "#0b1220",
          panel: "#111827",
          accent: "#3b82f6",
          warm: "#f59e0b",
          ok: "#10b981",
        },
      },
    },
  },
  plugins: [],
};
