type Theme = 'neutral' | 'selva';

const STORAGE_KEY = 'selva-theme';

class ThemeStore {
  private _theme = $state<Theme>('neutral');

  constructor() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored && (stored === 'neutral' || stored === 'selva')) {
        this._theme = stored;
      }
    }
  }

  get current(): Theme {
    return this._theme;
  }

  set(theme: Theme) {
    this._theme = theme;
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, theme);
      this.applyTheme(theme);
    }
  }

  private applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  toggle() {
    this.set(this._theme === 'neutral' ? 'selva' : 'neutral');
  }
}

export const themeStore = new ThemeStore();
export type { Theme };
