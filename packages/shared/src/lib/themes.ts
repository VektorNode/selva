export type Theme = 'neutral' | 'selva' | 'ocean' | 'cyberpunk';

export const themes: readonly Theme[] = ['neutral', 'selva', 'ocean', 'cyberpunk'] as const;

export const themeDescriptions: Record<Theme, string> = {
  neutral: 'Classic grayscale theme',
  selva: 'Forest green nature-inspired theme',
  ocean: 'Cool blue ocean theme',
  cyberpunk: 'Vibrant neon magenta theme',
};

export function isTheme(value: string): value is Theme {
  return themes.includes(value as Theme);
}

export function getThemePath(theme: Theme): string {
  return `/styles/themes/${theme}.css`;
}
