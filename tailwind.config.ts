import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      animation: {
        glow: 'glow 1.5s infinite',
        spinSlow: 'spin 5s linear infinite'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        primary: {
          50: 'hsl(40, 88%, 95%)', // Lightest Gold
          100: '#ccc297',
          200: '#E6C591',
          300: 'hsl(40, 88%, 65%)',
          400: '#C09A5E', // Default
          500: 'hsl(40, 88%, 45%)',
          600: 'hsl(40, 88%, 35%)',
          700: 'hsl(40, 88%, 25%)',
          800: 'hsl(40, 88%, 15%)',
          900: 'hsl(40, 88%, 10%)' // Darkest Gold
        },
        secondary: {
          50: 'hsl(360, 65%, 95%)',
          100: 'hsl(360, 65%, 85%)',
          200: 'hsl(360, 65%, 75%)',
          300: 'hsl(360, 65%, 65%)',
          400: 'hsl(360, 65%, 55%)',
          500: '#942023',
          600: 'hsl(360, 65%, 35%)',
          700: 'hsl(360, 65%, 25%)',
          800: 'hsl(360, 65%, 15%)',
          900: 'hsl(360, 65%, 10%)'
        },
        white: {
          50: 'hsl(45, 50%, 98%)', // Lightest warm white
          100: 'hsl(45, 50%, 95%)',
          200: 'hsl(45, 50%, 90%)',
          300: 'hsl(45, 50%, 85%)',
          400: 'hsl(45, 50%, 80%)',
          500: '#f9f5e7', // Base color
          600: 'hsl(45, 50%, 70%)',
          700: 'hsl(45, 50%, 60%)',
          800: 'hsl(45, 50%, 50%)',
          900: 'hsl(45, 50%, 40%)' // Darkest warm beige
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
export default config
