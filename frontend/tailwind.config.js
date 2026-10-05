/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        paper: "#e9edf3",
        mist: "#fbfcfe",
        ink: "#0b1220",
        muted: "#5c6573",
        line: "#e4e8ef",
        electric: "#2563eb",
        predict: "#6d28d9",
        sync: "#0891b2",
      },
      boxShadow: {
        card: "0 18px 50px -28px rgba(11, 18, 32, 0.22)",
        float: "0 28px 70px -32px rgba(11, 18, 32, 0.28)",
      },
      keyframes: {
        dash: {
          to: { strokeDashoffset: "-28" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.35", transform: "scale(1)" },
          "50%": { opacity: "0.12", transform: "scale(1.45)" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        bar: {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        dash: "dash 1.2s linear infinite",
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite",
        rise: "rise 0.45s ease-out",
        bar: "bar 0.7s ease-out",
      },
    },
  },
  plugins: [],
};
