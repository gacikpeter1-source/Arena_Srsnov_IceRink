/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}'
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      colors: {
        // Club brand colors — swap these per-tenant when re-branding.
        // Defaults below match Arena Sršňov's palette.
        primary: {
          DEFAULT: '#FDB913',
          yellow: '#FDB913',
          gold: '#E6A800',
          foreground: '#0a0a0a'
        },
        background: {
          DEFAULT: '#0a0a0a',
          darkest: '#0a0a0a',
          dark: '#1a1a1a',
          card: '#2a2a2a',
          cardHover: '#333333'
        },
        text: {
          primary: '#ffffff',
          secondary: '#e0e0e0',
          muted: '#a0a0a0'
        },
        border: {
          DEFAULT: '#3a3a3a',
          light: '#4a4a4a'
        },
        status: {
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          muted: '#6b7280'
        },
        // Shadcn compatibility
        input: '#3a3a3a',
        ring: '#FDB913',
        foreground: '#ffffff',
        secondary: {
          DEFAULT: '#2a2a2a',
          foreground: '#e0e0e0'
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#ffffff'
        },
        muted: {
          DEFAULT: '#2a2a2a',
          foreground: '#a0a0a0'
        },
        accent: {
          DEFAULT: '#FDB913',
          foreground: '#0a0a0a'
        },
        popover: {
          DEFAULT: '#2a2a2a',
          foreground: '#ffffff'
        },
        card: {
          DEFAULT: '#2a2a2a',
          foreground: '#ffffff'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: []
}
