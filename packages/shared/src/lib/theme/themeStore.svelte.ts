import { themes, isTheme, type Theme } from './themes';

const STORAGE_KEY = 'selva-theme';
const DEFAULT_THEME: Theme = 'neutral';

class ThemeStore {
	private _theme = $state<Theme>(DEFAULT_THEME);

	constructor() {
		if (typeof window !== 'undefined') {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored && isTheme(stored)) {
				this._theme = stored;
			}
		}
	}

	get current(): Theme {
		return this._theme;
	}

	get availableThemes(): readonly Theme[] {
		return themes;
	}

	set(theme: Theme) {
		if (!isTheme(theme)) {
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
		const currentIndex = themes.indexOf(this._theme);
		const nextIndex = (currentIndex + 1) % themes.length;
		this.set(themes[nextIndex]);
	}
}

export const themeStore = new ThemeStore();
export type { Theme };
