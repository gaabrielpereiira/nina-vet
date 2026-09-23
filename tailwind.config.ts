import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        white: "hsl(var(--c-white) / <alpha-value>)",
        black: "hsl(var(--c-black) / <alpha-value>)",
        slate: {
          50: "hsl(var(--s-50) / <alpha-value>)",
          100: "hsl(var(--s-100) / <alpha-value>)",
          200: "hsl(var(--s-200) / <alpha-value>)",
          300: "hsl(var(--s-300) / <alpha-value>)",
          400: "hsl(var(--s-400) / <alpha-value>)",
          500: "hsl(var(--s-500) / <alpha-value>)",
          600: "hsl(var(--s-600) / <alpha-value>)",
          700: "hsl(var(--s-700) / <alpha-value>)",
          800: "hsl(var(--s-800) / <alpha-value>)",
          900: "hsl(var(--s-900) / <alpha-value>)",
          950: "hsl(var(--s-950) / <alpha-value>)",
        },
        cyan: {
          50: "hsl(183 100% 96% / <alpha-value>)",
          100: "hsl(185 96% 90% / <alpha-value>)",
          200: "hsl(var(--a-200) / <alpha-value>)",
          300: "hsl(var(--a-300) / <alpha-value>)",
          400: "hsl(var(--a-400) / <alpha-value>)",
          500: "hsl(var(--a-500) / <alpha-value>)",
          600: "hsl(192 91% 36% / <alpha-value>)",
          700: "hsl(193 82% 31% / <alpha-value>)",
          800: "hsl(194 70% 27% / <alpha-value>)",
          900: "hsl(196 64% 24% / <alpha-value>)",
          950: "hsl(197 79% 15% / <alpha-value>)",
        },
        emerald: {
          300: "hsl(var(--e-300) / <alpha-value>)",
          400: "hsl(var(--e-400) / <alpha-value>)",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
  plugins: [tailwindcssAnimate],
} satisfies Config;