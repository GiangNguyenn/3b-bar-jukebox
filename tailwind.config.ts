import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        glow: "glow 1.5s infinite",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          50: "hsl(40, 88%, 95%)", // Lightest Gold
          100: "#ccc297",
          200: "#E6C591",
          300: "hsl(40, 88%, 65%)",
          400: "#C09A5E", // Default
          500: "hsl(40, 88%, 45%)",
          600: "hsl(40, 88%, 35%)",
          700: "hsl(40, 88%, 25%)",
          800: "hsl(40, 88%, 15%)",
          900: "hsl(40, 88%, 10%)", // Darkest Gold
        },
        secondary: {
          50: "hsl(220, 15%, 95%)", // Lightest Blue
          100: "hsl(220, 15%, 85%)",
          200: "hsl(220, 15%, 75%)",
          300: "hsl(220, 15%, 65%)",
          400: "hsl(220, 15%, 55%)",
          500: "hsl(220, 15%, 45%)",
          600: "hsl(220, 15%, 35%)",
          700: "hsl(220, 15%, 25%)",
          800: "hsl(220, 15%, 15%)",
          900: "hsl(220, 15%, 10%)", // Darkest Blue
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), heroui()],
};
export default config;
