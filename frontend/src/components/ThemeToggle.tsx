import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

type Theme = 'nord' | 'dim'

const STORAGE_KEY = 'theme'

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'nord' || stored === 'dim') return stored
  } catch {
    // Storage blocked: fall back to the system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dim' : 'nord'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Not persisted; the choice still applies to this visit.
    }
  }, [theme])

  const isDark = theme === 'dim'
  return (
    <button
      type="button"
      className="btn btn-ghost btn-circle"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        setTheme(isDark ? 'nord' : 'dim')
      }}
    >
      {isDark ? <Sun aria-hidden className="size-5" /> : <Moon aria-hidden className="size-5" />}
    </button>
  )
}
