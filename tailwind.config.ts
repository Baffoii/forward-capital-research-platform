import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },

        // Redesign palette. `fc-` prefixed so it can never collide with a
        // built-in Tailwind scale. These resolve through the --fc-* custom
        // properties in index.css, so they follow light/dark automatically.
        // Authored as hex rather than HSL triplets, so no /<alpha-value>
        // support — reach for an explicit rgba() token when you need one.
        "fc-paper": { DEFAULT: "var(--fc-paper)", sunk: "var(--fc-paper-sunk)" },
        "fc-surface": { DEFAULT: "var(--fc-surface)", sunk: "var(--fc-surface-sunk)" },
        "fc-rule": {
          DEFAULT: "var(--fc-rule)",
          soft: "var(--fc-rule-soft)",
          strong: "var(--fc-rule-strong)",
        },
        "fc-chip": "var(--fc-chip)",
        "fc-ink": {
          DEFAULT: "var(--fc-ink)",
          "2": "var(--fc-ink-2)",
          "3": "var(--fc-ink-3)",
          "4": "var(--fc-ink-4)",
          "5": "var(--fc-ink-5)",
        },
        "fc-teal": {
          DEFAULT: "var(--fc-teal)",
          deep: "var(--fc-teal-deep)",
          ink: "var(--fc-teal-ink)",
          wash: "var(--fc-teal-wash)",
          line: "var(--fc-teal-line)",
          panel: "var(--fc-teal-panel)",
        },
        "fc-forest": {
          DEFAULT: "var(--fc-forest)",
          bright: "var(--fc-forest-bright)",
          wash: "var(--fc-forest-wash)",
          line: "var(--fc-forest-line)",
        },
        "fc-oxide": {
          DEFAULT: "var(--fc-oxide)",
          bright: "var(--fc-oxide-bright)",
          wash: "var(--fc-oxide-wash)",
          line: "var(--fc-oxide-line)",
          panel: "var(--fc-oxide-panel)",
          "panel-line": "var(--fc-oxide-panel-line)",
          border: "var(--fc-oxide-border)",
        },
        "fc-ochre": {
          DEFAULT: "var(--fc-amber)",
          deep: "var(--fc-amber-deep)",
          wash: "var(--fc-amber-wash)",
          line: "var(--fc-amber-line)",
          panel: "var(--fc-amber-panel)",
        },
        "fc-azure": {
          DEFAULT: "var(--fc-azure)",
          bright: "var(--fc-azure-bright)",
          wash: "var(--fc-azure-wash)",
          line: "var(--fc-azure-line)",
        },
        "fc-iris": {
          DEFAULT: "var(--fc-violet)",
          wash: "var(--fc-violet-wash)",
          line: "var(--fc-violet-line)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
