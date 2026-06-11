// ============================================================================
// Viewer message catalog (library-owned strings)
// ============================================================================
//
// These are the strings @selvajs/ui renders itself in the 3D viewer and its
// panels — tool menu, view presets, scene manager, metadata dialog. They are
// NOT the strings that come from a Grasshopper definition (mesh/layer/metadata
// names): those live in the user's .gh file and can't be translated here.
//
// The library ships English + German. A host app can switch locale at runtime
// via the locale context (see ./localeContext.svelte.ts) — e.g. selva feeds its
// own Paraglide locale in. With no provider, components fall back to English.

export type Locale = 'en' | 'de';

export interface ViewerMessages {
	// Tools menu
	toolsMenu: string;
	switchTo2D: string;
	switchTo3D: string;
	fitToView: string;
	views: string;
	measure: string;
	grid: string;
	sceneManager: string;
	screenshot: string;
	fullscreen: string;
	exitFullscreen: string;

	// View presets
	viewTop: string;
	viewFront: string;
	viewRight: string;
	viewBack: string;
	viewLeft: string;
	viewBottom: string;
	viewIso: string;

	// Scene manager
	searchObjects: string;
	clearSearch: string;
	expandLayer: string;
	collapseLayer: string;
	showLayer: string;
	hideLayer: string;
	showObject: string;
	hideObject: string;
	noObjects: string;
	/** `{query}` is replaced with the current search text. */
	noResultsFor: string;

	// Metadata dialog
	objectFallbackName: string;
	noMetadata: string;
}

const en: ViewerMessages = {
	toolsMenu: 'Viewer tools',
	switchTo2D: 'Switch to 2D',
	switchTo3D: 'Switch to 3D',
	fitToView: 'Fit to view',
	views: 'Views',
	measure: 'Measure',
	grid: 'Grid',
	sceneManager: 'Scene manager',
	screenshot: 'Screenshot',
	fullscreen: 'Fullscreen',
	exitFullscreen: 'Exit fullscreen',

	viewTop: 'Top',
	viewFront: 'Front',
	viewRight: 'Right',
	viewBack: 'Back',
	viewLeft: 'Left',
	viewBottom: 'Bottom',
	viewIso: 'Isometric',

	searchObjects: 'Search objects...',
	clearSearch: 'Clear search',
	expandLayer: 'Expand layer',
	collapseLayer: 'Collapse layer',
	showLayer: 'Show layer',
	hideLayer: 'Hide layer',
	showObject: 'Show object',
	hideObject: 'Hide object',
	noObjects: 'No objects',
	noResultsFor: 'No results for "{query}"',

	objectFallbackName: 'Object',
	noMetadata: 'No metadata'
};

const de: ViewerMessages = {
	toolsMenu: 'Viewer-Werkzeuge',
	switchTo2D: 'Zu 2D wechseln',
	switchTo3D: 'Zu 3D wechseln',
	fitToView: 'Ansicht anpassen',
	views: 'Ansichten',
	measure: 'Messen',
	grid: 'Raster',
	sceneManager: 'Szenen-Manager',
	screenshot: 'Screenshot',
	fullscreen: 'Vollbild',
	exitFullscreen: 'Vollbild beenden',

	viewTop: 'Oben',
	viewFront: 'Vorne',
	viewRight: 'Rechts',
	viewBack: 'Hinten',
	viewLeft: 'Links',
	viewBottom: 'Unten',
	viewIso: 'Isometrisch',

	searchObjects: 'Objekte suchen...',
	clearSearch: 'Suche löschen',
	expandLayer: 'Ebene aufklappen',
	collapseLayer: 'Ebene zuklappen',
	showLayer: 'Ebene einblenden',
	hideLayer: 'Ebene ausblenden',
	showObject: 'Objekt einblenden',
	hideObject: 'Objekt ausblenden',
	noObjects: 'Keine Objekte',
	noResultsFor: 'Keine Ergebnisse für „{query}“',

	objectFallbackName: 'Objekt',
	noMetadata: 'Keine Metadaten'
};

export const VIEWER_MESSAGES: Record<Locale, ViewerMessages> = { en, de };

export const DEFAULT_LOCALE: Locale = 'en';

/** Resolve a catalog for a locale, falling back to English for unknown locales. */
export function messagesFor(locale: Locale | undefined): ViewerMessages {
	return VIEWER_MESSAGES[locale ?? DEFAULT_LOCALE] ?? VIEWER_MESSAGES[DEFAULT_LOCALE];
}
