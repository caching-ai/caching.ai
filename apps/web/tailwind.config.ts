import type { Config } from "tailwindcss";

// Design system (Webflow concept) — weights capped at 600, radius 4px buttons /
// 8px cards, 5 accent colors are category-card fills only (never buttons).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#080808",
        accent: {
          purple: "#7a3dff",
          pink: "#ed52cb",
          blue: "#3b89ff",
          orange: "#ff6b00",
          green: "#00d722",
        },
        "blue-deep": "#006acc",
        "blue-info": "#146ef5",
        warn: "#ffae13",
        error: "#ee1d36",
        canvas: "#ffffff",
        hairline: "#d8d8d8",
        ink: "#080808",
        "ink-strong": "#222222",
        body: "#363636",
        "body-mid": "#5a5a5a",
        mute: "#898989",
        "mute-soft": "#ababab",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["Inconsolata", "monospace"],
      },
      fontSize: {
        hero: ["80px", { lineHeight: "1.05", letterSpacing: "-0.8px", fontWeight: "600" }],
        "display-xl": ["56px", { lineHeight: "1.1", fontWeight: "600" }],
        "display-lg": ["44.8px", { lineHeight: "1.12", fontWeight: "600" }],
        "display-md": ["32px", { lineHeight: "1.2", fontWeight: "500" }],
        "body-lg": ["28.8px", { lineHeight: "1.4", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "1.6", letterSpacing: "-0.16px", fontWeight: "400" }],
        eyebrow: ["15px", { lineHeight: "1.2", letterSpacing: "1.5px", fontWeight: "500" }],
        badge: ["12.8px", { lineHeight: "1.2", fontWeight: "550" }],
      },
      boxShadow: {
        featured:
          "0 30px 18px rgba(0,0,0,.04), 0 13px 13px rgba(0,0,0,.08), 0 3px 7px rgba(0,0,0,.09)",
      },
      borderRadius: {
        btn: "4px",
        card: "8px",
      },
    },
  },
  plugins: [],
};
export default config;
