// ============================================================================
// Viewer message catalog (library-owned strings)
// ============================================================================
//
// Only the strings @selvajs/ui renders itself. Names coming from a Grasshopper
// definition (meshes, layers, metadata keys) live in the user's .gh file and
// cannot be translated here.

export type Locale = 'en' | 'de';

export interface ViewerMessages {
	// Tools menu
	toolsMenu: string;
	switchToOrthographic: string;
	switchToPerspective: string;
	fitToView: string;
	views: string;
	measure: string;
	grid: string;
	display: string;
	edges: string;
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
	expandAll: string;
	collapseAll: string;
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

	// App layout / compute shell
	loadingSchema: string;
	parametersTab: string;
	moreTab: string;
	expandPanel: string;
	collapsePanel: string;
	/** `{side}` is replaced with `panelSideLeft` / `panelSideRight`. */
	expandSidePanel: string;
	panelSideLeft: string;
	panelSideRight: string;
	tabNoGroups: string;

	// Solve controls
	solving: string;
	solvingEllipsis: string;
	solvingSubtitle: string;
	pressToCalculate: string;
	calculate: string;
	upToDate: string;
}

const en: ViewerMessages = {
	toolsMenu: 'Viewer tools',
	switchToOrthographic: 'Orthographic camera',
	switchToPerspective: 'Perspective camera',
	fitToView: 'Fit to view',
	views: 'Views',
	measure: 'Measure',
	grid: 'Grid',
	display: 'Display',
	edges: 'Edges',
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
	expandAll: 'Expand all',
	collapseAll: 'Collapse all',
	showLayer: 'Show layer',
	hideLayer: 'Hide layer',
	showObject: 'Show object',
	hideObject: 'Hide object',
	noObjects: 'No objects',
	noResultsFor: 'No results for "{query}"',

	objectFallbackName: 'Object',
	noMetadata: 'No metadata',

	loadingSchema: 'Loading schema...',
	parametersTab: 'Parameters',
	moreTab: 'More',
	expandPanel: 'Expand panel',
	collapsePanel: 'Collapse panel',
	expandSidePanel: 'Expand {side} panel',
	panelSideLeft: 'left',
	panelSideRight: 'right',
	tabNoGroups: 'This tab has no groups configured.',

	solving: 'Solving',
	solvingEllipsis: 'Solving...',
	solvingSubtitle: 'Grasshopper is calculating...',
	pressToCalculate: 'Press to calculate',
	calculate: 'Calculate',
	upToDate: 'Up to date'
};

const de: ViewerMessages = {
	toolsMenu: 'Viewer-Werkzeuge',
	switchToOrthographic: 'Orthografische Kamera',
	switchToPerspective: 'Perspektivische Kamera',
	fitToView: 'Ansicht anpassen',
	views: 'Ansichten',
	measure: 'Messen',
	grid: 'Raster',
	display: 'Darstellung',
	edges: 'Kanten',
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
	expandAll: 'Alle aufklappen',
	collapseAll: 'Alle zuklappen',
	showLayer: 'Ebene einblenden',
	hideLayer: 'Ebene ausblenden',
	showObject: 'Objekt einblenden',
	hideObject: 'Objekt ausblenden',
	noObjects: 'Keine Objekte',
	noResultsFor: 'Keine Ergebnisse für „{query}“',

	objectFallbackName: 'Objekt',
	noMetadata: 'Keine Metadaten',

	loadingSchema: 'Schema wird geladen...',
	parametersTab: 'Parameter',
	moreTab: 'Mehr',
	expandPanel: 'Bereich aufklappen',
	collapsePanel: 'Bereich zuklappen',
	expandSidePanel: '{side} Bereich aufklappen',
	panelSideLeft: 'Linken',
	panelSideRight: 'Rechten',
	tabNoGroups: 'Für diesen Tab sind keine Gruppen konfiguriert.',

	solving: 'Berechnung läuft',
	solvingEllipsis: 'Berechnung läuft...',
	solvingSubtitle: 'Grasshopper berechnet...',
	pressToCalculate: 'Zum Berechnen klicken',
	calculate: 'Berechnen',
	upToDate: 'Aktuell'
};

export const VIEWER_MESSAGES: Record<Locale, ViewerMessages> = { en, de };

export const DEFAULT_LOCALE: Locale = 'en';

export function messagesFor(locale: Locale | undefined): ViewerMessages {
	return VIEWER_MESSAGES[locale ?? DEFAULT_LOCALE] ?? VIEWER_MESSAGES[DEFAULT_LOCALE];
}
