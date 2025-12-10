type Theme = 'neutral' | 'selva' | 'ocean' | 'cyberpunk';

const STORAGE_KEY = 'selva-theme';
const DEFAULT_THEME: Theme = 'neutral';

// Available themes list - add new themes here
const AVAILABLE_THEMES: Theme[] = ['neutral', 'selva', 'ocean', 'cyberpunk'];

class ThemeStore {
  private _theme = $state<Theme>(DEFAULT_THEME);

  constructor() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      // Validate that stored theme is in available themes
      if (stored && AVAILABLE_THEMES.includes(stored)) {
        this._theme = stored;
      }
    }
  }

  get current(): Theme {
    return this._theme;
  }

  get availableThemes(): Theme[] {
    return AVAILABLE_THEMES;
  }

  set(theme: Theme) {
    if (!AVAILABLE_THEMES.includes(theme)) {
      console.warn(`Theme "${theme}" is not available. Falling back to default.`);
      return;
    }
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
    const currentIndex = AVAILABLE_THEMES.indexOf(this._theme);
    const nextIndex = (currentIndex + 1) % AVAILABLE_THEMES.length;
    this.set(AVAILABLE_THEMES[nextIndex]);
  }
}

export const themeStore = new ThemeStore();
export type { Theme };
