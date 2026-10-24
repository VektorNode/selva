// ============================================================================
// Viewer message catalog (library-owned strings)
// ============================================================================
//
// Only the strings @selvajs/ui renders itself. Names coming from a Grasshopper
// definition — meshes, layers, metadata keys — live in the user's .gh file and
// cannot be translated here.
//
// A `{name}` in a message is a placeholder the component fills in. Pairs ending in
// `One`/`Other` are the singular and plural forms of one message.

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

	// Display looks
	lookTechnical: string;
	lookStudio: string;
	lookShowcase: string;
	lookArctic: string;
	lookXray: string;
	lookLineart: string;
	lookWireframe: string;

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
	solveBlocked: string;
	solveBlockedTitle: string;
	solveMessagesTitle: string;
	solveMessagesDescription: string;
	solveMessagesConfirm: string;
	solveMessagesDiscard: string;
	solveMessagesAbort: string;
	solveMessagesDismiss: string;
	solveSolving: string;
	parametersTab: string;
	moreTab: string;
	scrollTabsBack: string;
	scrollTabsForward: string;
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
	/** The panel footer's ⋯ menu: saving and loading inputs, plus the host's own actions. */
	moreActions: string;
	/** Under a menu action that solves before it runs, while the inputs have changed. */
	calculatesFirst: string;

	// Footer and message centre
	/** `{count}` is replaced with the number of errors. */
	errorCountOne: string;
	errorCountOther: string;
	/** `{count}` is replaced with the number of warnings. */
	warningCountOne: string;
	warningCountOther: string;
	/** `{count}` is replaced with the number of notes. */
	noteCountOne: string;
	noteCountOther: string;
	/** `{count}` is replaced with the number of messages. */
	lastSolveMessagesOne: string;
	lastSolveMessagesOther: string;
	messagesTitle: string;
	/** `{name}` is replaced with the copyright holder, `{year}` with the current year. */
	copyright: string;
	close: string;
	toggleTheme: string;
	errorTitle: string;
	goHome: string;

	// Input fields
	selectOption: string;
	noOptionsYet: string;
	/** `{min}` is replaced with the field's minimum. */
	minValue: string;
	/** `{max}` is replaced with the field's maximum. */
	maxValue: string;
	fineDragHint: string;
	/** `{max}` is replaced with the field's character limit. */
	maxLength: string;
	invalidFormat: string;
	invalidPattern: string;

	// Geometry input (Rhino only)
	/** The pick button when the input takes several kinds of object. */
	geometryPick: string;
	geometryPickAgain: string;
	geometryClear: string;
	// The pick button when the input takes one kind: `One` picks a single object, `Other` several.
	geometryPickPointOne: string;
	geometryPickPointOther: string;
	geometryPickPointCloudOne: string;
	geometryPickPointCloudOther: string;
	geometryPickCurveOne: string;
	geometryPickCurveOther: string;
	geometryPickLineOne: string;
	geometryPickLineOther: string;
	geometryPickPlaneOne: string;
	geometryPickPlaneOther: string;
	geometryPickSurfaceOne: string;
	geometryPickSurfaceOther: string;
	geometryPickPolysurfaceOne: string;
	geometryPickPolysurfaceOther: string;
	geometryPickExtrusionOne: string;
	geometryPickExtrusionOther: string;
	geometryPickMeshOne: string;
	geometryPickMeshOther: string;
	geometryPickSubdOne: string;
	geometryPickSubdOther: string;
	geometryPickBlockOne: string;
	geometryPickBlockOther: string;

	// File input
	fileModeUpload: string;
	fileModeUrl: string;
	fileUrlLabel: string;
	fetchFile: string;
	fetchingFile: string;
	fileUrlPublic: string;
	chooseFile: string;
	/** `{formats}` is replaced with the accepted extensions. */
	acceptedFormats: string;
	/** `{ext}` is replaced with the file's extension. */
	uploadedFile: string;
	/** `{ext}` is replaced with the file's extension, `{size}` with its size in MB. */
	uploadedFileSize: string;
	/** `{ext}` is replaced with the file's extension, `{size}` with its size in KB. */
	fileLoaded: string;
	urlInvalid: string;
	urlProtocolUnsupported: string;
	/** `{status}` is replaced with the HTTP status the server answered with. */
	urlServerError: string;
	/** `{ext}` is replaced with the rejected extension, `{formats}` with the accepted ones. */
	fileFormatNotAccepted: string;
	/** `{size}` is replaced with the file's size in MB, `{max}` with the limit in MB. */
	fileTooLarge: string;
	fileTooLargeUseUpload: string;
	fileReadFailed: string;
	/** `{host}` is replaced with the URL's host name. */
	urlUnreachable: string;
	urlUnreachableHint: string;
	urlHintSharePoint: string;
	urlHintGoogleDrive: string;
	urlHintDropbox: string;
	unknownError: string;

	// Outputs
	waitingForData: string;
	waitingForFiles: string;
	/** `{count}` is replaced with the number of files. */
	fileCount: string;
	duplicateFilesTitle: string;
	duplicatePathsOne: string;
	duplicatePathsOther: string;
	duplicateFilesHint: string;
	downloadFile: string;
	/** `{count}` is replaced with the number of files. */
	downloadFiles: string;
	downloading: string;
	downloadFailed: string;
	copy: string;
	copied: string;
	chartReceiving: string;
	chartRenderFailed: string;
	/** `{error}` is replaced with the browser's reason. */
	fullscreenUnavailable: string;
	/** `{error}` is replaced with the browser's reason. */
	exitFullscreenFailed: string;

	// Image output
	imageViewer: string;
	imageLoading: string;
	/** `{ext}` is replaced with the file's extension, `{formats}` with the supported ones. */
	imageUnsupported: string;
	imageUnknownFormat: string;
	/** `{file}` is replaced with the file's name. */
	imageDecodeFailed: string;
	previousImage: string;
	nextImage: string;
	zoomHint: string;
	zoomIn: string;
	zoomOut: string;
	zoomFit: string;
	zoomActual: string;
	downloadImage: string;
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

	lookTechnical: 'Technical',
	lookStudio: 'Studio',
	lookShowcase: 'Showcase',
	lookArctic: 'Arctic',
	lookXray: 'X-Ray',
	lookLineart: 'Line Art',
	lookWireframe: 'Wireframe',

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

	loadingSchema: 'Loading…',
	solveBlocked: 'The definition stopped this solve. No results were produced.',
	solveBlockedTitle: 'Solve stopped',
	solveMessagesTitle: 'Solve messages',
	solveMessagesDescription: 'This solve reported the following. Continue to see the result.',
	solveMessagesConfirm: 'Continue',
	solveMessagesDiscard: 'Discard',
	solveMessagesAbort: 'Abort',
	solveMessagesDismiss: 'Dismiss',
	solveSolving: 'Solving…',
	parametersTab: 'Parameters',
	moreTab: 'More',
	scrollTabsBack: 'Previous tabs',
	scrollTabsForward: 'More tabs',
	expandSidePanel: 'Expand {side} panel',
	panelSideLeft: 'left',
	panelSideRight: 'right',
	tabNoGroups: 'This tab has no groups configured.',

	solving: 'Solving',
	solvingEllipsis: 'Solving...',
	solvingSubtitle: 'This can take a moment…',
	pressToCalculate: 'Press to calculate',
	calculate: 'Calculate',
	upToDate: 'Up to date',
	moreActions: 'More actions',
	calculatesFirst: 'Calculates first',

	errorCountOne: '{count} error',
	errorCountOther: '{count} errors',
	warningCountOne: '{count} warning',
	warningCountOther: '{count} warnings',
	noteCountOne: '{count} note',
	noteCountOther: '{count} notes',
	lastSolveMessagesOne: '{count} message from the last solve',
	lastSolveMessagesOther: '{count} messages from the last solve',
	messagesTitle: 'Messages',
	copyright: 'by {name} © {year}',
	close: 'Close',
	toggleTheme: 'Toggle theme',
	errorTitle: 'Error',
	goHome: 'Go Home',

	selectOption: 'Select an option...',
	noOptionsYet: 'No options available yet.',
	minValue: 'Minimum value is {min}',
	maxValue: 'Maximum value is {max}',
	fineDragHint: 'Hold Shift to drag finely',
	maxLength: 'Maximum {max} characters allowed',
	invalidFormat: 'Invalid format',
	invalidPattern: 'Invalid validation pattern configured',

	geometryPick: 'Pick in Rhino',
	geometryPickAgain: 'Pick again',
	geometryClear: 'Clear',
	geometryPickPointOne: 'Pick a point',
	geometryPickPointOther: 'Pick points',
	geometryPickPointCloudOne: 'Pick a point cloud',
	geometryPickPointCloudOther: 'Pick point clouds',
	geometryPickCurveOne: 'Pick a curve',
	geometryPickCurveOther: 'Pick curves',
	geometryPickLineOne: 'Pick a line',
	geometryPickLineOther: 'Pick lines',
	geometryPickPlaneOne: 'Pick a plane',
	geometryPickPlaneOther: 'Pick planes',
	geometryPickSurfaceOne: 'Pick a surface',
	geometryPickSurfaceOther: 'Pick surfaces',
	geometryPickPolysurfaceOne: 'Pick a polysurface',
	geometryPickPolysurfaceOther: 'Pick polysurfaces',
	geometryPickExtrusionOne: 'Pick an extrusion',
	geometryPickExtrusionOther: 'Pick extrusions',
	geometryPickMeshOne: 'Pick a mesh',
	geometryPickMeshOther: 'Pick meshes',
	geometryPickSubdOne: 'Pick a SubD',
	geometryPickSubdOther: 'Pick SubDs',
	geometryPickBlockOne: 'Pick a block',
	geometryPickBlockOther: 'Pick blocks',

	fileModeUpload: 'Upload',
	fileModeUrl: 'URL',
	fileUrlLabel: 'File URL',
	fetchFile: 'Fetch',
	fetchingFile: 'Fetching...',
	fileUrlPublic: 'URL must be publicly accessible (no login required).',
	chooseFile: 'Choose File or Drag & Drop',
	acceptedFormats: 'Accepted formats: {formats}',
	uploadedFile: 'Uploaded file ({ext})',
	uploadedFileSize: 'Uploaded file ({ext}, {size}MB)',
	fileLoaded: 'Loaded {ext} ({size} KB)',
	urlInvalid: 'Invalid URL — make sure it starts with https://',
	urlProtocolUnsupported: 'Only http:// and https:// URLs are supported.',
	urlServerError: 'Server returned {status}. Check the URL is correct and publicly accessible.',
	fileFormatNotAccepted: 'File format "{ext}" is not accepted. Allowed: {formats}',
	fileTooLarge: 'File too large: {size}MB (max {max}MB).',
	fileTooLargeUseUpload: 'Download it and use Upload instead.',
	fileReadFailed: 'Failed to read the downloaded file.',
	urlUnreachable:
		'Could not reach "{host}" — the file may not exist, or the server does not allow browser access.',
	urlUnreachableHint:
		'Check that the URL is correct and the file is publicly accessible. If the server requires login, download the file and use the Upload option instead.',
	urlHintSharePoint:
		'SharePoint/OneDrive blocks browser access. Open the file in SharePoint, use "Download" to save it locally, then upload it here.',
	urlHintGoogleDrive:
		'Google Drive blocks browser access. Use "Download" in Google Drive to save the file locally, then upload it here.',
	urlHintDropbox:
		'Dropbox links may block browser access. Try changing "?dl=0" to "?dl=1" in the URL, or download and upload instead.',
	unknownError: 'Unknown error',

	waitingForData: 'Waiting for data...',
	waitingForFiles: 'Waiting for file data...',
	fileCount: '{count} files',
	duplicateFilesTitle: 'Duplicate file names detected',
	duplicatePathsOne: 'The following path appears more than once:',
	duplicatePathsOther: 'The following paths appear more than once:',
	duplicateFilesHint:
		'Rename outputs in your Grasshopper definition so each file has a unique name.',
	downloadFile: 'Download File',
	downloadFiles: 'Download {count} Files',
	downloading: 'Downloading...',
	downloadFailed: 'Download failed',
	copy: 'Copy',
	copied: 'Copied!',
	chartReceiving: 'Receiving chart data...',
	chartRenderFailed: 'Failed to render chart',
	fullscreenUnavailable: 'Fullscreen unavailable: {error}',
	exitFullscreenFailed: 'Exit fullscreen failed: {error}',

	imageViewer: 'image viewer',
	imageLoading: 'Loading image…',
	imageUnsupported: 'Unsupported image format: {ext}. Supported: {formats}',
	imageUnknownFormat: '(unknown)',
	imageDecodeFailed: "Couldn't decode {file}",
	previousImage: 'Previous image',
	nextImage: 'Next image',
	zoomHint: 'Hold Ctrl or ⌘ and scroll to zoom',
	zoomIn: 'Zoom in',
	zoomOut: 'Zoom out',
	zoomFit: 'Fit',
	zoomActual: 'Actual pixels',
	downloadImage: 'Download image'
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

	lookTechnical: 'Technisch',
	lookStudio: 'Studio',
	lookShowcase: 'Präsentation',
	lookArctic: 'Arktis',
	lookXray: 'Röntgen',
	lookLineart: 'Strichzeichnung',
	lookWireframe: 'Drahtgitter',

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

	loadingSchema: 'Wird geladen…',
	solveBlocked: 'Die Definition hat diese Berechnung gestoppt. Es wurden keine Ergebnisse erzeugt.',
	solveBlockedTitle: 'Berechnung gestoppt',
	solveMessagesTitle: 'Meldungen zur Berechnung',
	solveMessagesDescription:
		'Diese Berechnung hat Folgendes gemeldet. Weiter, um das Ergebnis zu sehen.',
	solveMessagesConfirm: 'Weiter',
	solveMessagesDiscard: 'Verwerfen',
	solveMessagesAbort: 'Abbrechen',
	solveMessagesDismiss: 'Schliessen',
	solveSolving: 'Berechnung läuft…',
	parametersTab: 'Parameter',
	moreTab: 'Mehr',
	scrollTabsBack: 'Vorherige Tabs',
	scrollTabsForward: 'Weitere Tabs',
	expandSidePanel: '{side} Bereich aufklappen',
	panelSideLeft: 'Linken',
	panelSideRight: 'Rechten',
	tabNoGroups: 'Für diesen Tab sind keine Gruppen konfiguriert.',

	solving: 'Berechnung läuft',
	solvingEllipsis: 'Berechnung läuft...',
	solvingSubtitle: 'Das kann einen Moment dauern…',
	pressToCalculate: 'Berechnen',
	calculate: 'Berechnen',
	upToDate: 'Berechnet',
	moreActions: 'Weitere Aktionen',
	calculatesFirst: 'Berechnet zuerst',

	errorCountOne: '{count} Fehler',
	errorCountOther: '{count} Fehler',
	warningCountOne: '{count} Warnung',
	warningCountOther: '{count} Warnungen',
	noteCountOne: '{count} Hinweis',
	noteCountOther: '{count} Hinweise',
	lastSolveMessagesOne: '{count} Meldung der letzten Berechnung',
	lastSolveMessagesOther: '{count} Meldungen der letzten Berechnung',
	messagesTitle: 'Meldungen',
	copyright: 'von {name} © {year}',
	close: 'Schliessen',
	toggleTheme: 'Farbschema wechseln',
	errorTitle: 'Fehler',
	goHome: 'Zur Startseite',

	selectOption: 'Option wählen…',
	noOptionsYet: 'Noch keine Optionen verfügbar.',
	minValue: 'Der kleinste erlaubte Wert ist {min}',
	maxValue: 'Der grösste erlaubte Wert ist {max}',
	fineDragHint: 'Umschalttaste halten für feine Schritte',
	maxLength: 'Höchstens {max} Zeichen erlaubt',
	invalidFormat: 'Ungültiges Format',
	invalidPattern: 'Ungültiges Prüfmuster hinterlegt',

	geometryPick: 'In Rhino wählen',
	geometryPickAgain: 'Neu wählen',
	geometryClear: 'Leeren',
	geometryPickPointOne: 'Punkt wählen',
	geometryPickPointOther: 'Punkte wählen',
	geometryPickPointCloudOne: 'Punktwolke wählen',
	geometryPickPointCloudOther: 'Punktwolken wählen',
	geometryPickCurveOne: 'Kurve wählen',
	geometryPickCurveOther: 'Kurven wählen',
	geometryPickLineOne: 'Linie wählen',
	geometryPickLineOther: 'Linien wählen',
	geometryPickPlaneOne: 'Ebene wählen',
	geometryPickPlaneOther: 'Ebenen wählen',
	geometryPickSurfaceOne: 'Fläche wählen',
	geometryPickSurfaceOther: 'Flächen wählen',
	geometryPickPolysurfaceOne: 'Flächenverband wählen',
	geometryPickPolysurfaceOther: 'Flächenverbände wählen',
	geometryPickExtrusionOne: 'Extrusion wählen',
	geometryPickExtrusionOther: 'Extrusionen wählen',
	geometryPickMeshOne: 'Netz wählen',
	geometryPickMeshOther: 'Netze wählen',
	geometryPickSubdOne: 'SubD wählen',
	geometryPickSubdOther: 'SubDs wählen',
	geometryPickBlockOne: 'Block wählen',
	geometryPickBlockOther: 'Blöcke wählen',

	fileModeUpload: 'Hochladen',
	fileModeUrl: 'URL',
	fileUrlLabel: 'Datei-URL',
	fetchFile: 'Abrufen',
	fetchingFile: 'Wird abgerufen…',
	fileUrlPublic: 'Die URL muss öffentlich erreichbar sein (ohne Anmeldung).',
	chooseFile: 'Datei wählen oder hierher ziehen',
	acceptedFormats: 'Erlaubte Formate: {formats}',
	uploadedFile: 'Hochgeladene Datei ({ext})',
	uploadedFileSize: 'Hochgeladene Datei ({ext}, {size} MB)',
	fileLoaded: '{ext} geladen ({size} KB)',
	urlInvalid: 'Ungültige URL – sie muss mit https:// beginnen',
	urlProtocolUnsupported: 'Nur http://- und https://-URLs werden unterstützt.',
	urlServerError:
		'Der Server antwortete mit {status}. Ist die URL korrekt und öffentlich erreichbar?',
	fileFormatNotAccepted: 'Dateiformat „{ext}“ ist nicht erlaubt. Erlaubt: {formats}',
	fileTooLarge: 'Datei zu gross: {size} MB (höchstens {max} MB).',
	fileTooLargeUseUpload: 'Datei herunterladen und stattdessen über „Hochladen“ einfügen.',
	fileReadFailed: 'Die heruntergeladene Datei konnte nicht gelesen werden.',
	urlUnreachable:
		'„{host}“ ist nicht erreichbar – die Datei existiert vielleicht nicht, oder der Server erlaubt keinen Zugriff aus dem Browser.',
	urlUnreachableHint:
		'Prüfen, ob die URL stimmt und die Datei öffentlich erreichbar ist. Verlangt der Server eine Anmeldung: Datei herunterladen und über „Hochladen“ einfügen.',
	urlHintSharePoint:
		'SharePoint/OneDrive sperrt den Zugriff aus dem Browser. Datei in SharePoint öffnen, mit „Herunterladen“ lokal speichern und hier hochladen.',
	urlHintGoogleDrive:
		'Google Drive sperrt den Zugriff aus dem Browser. Datei in Google Drive mit „Herunterladen“ lokal speichern und hier hochladen.',
	urlHintDropbox:
		'Dropbox-Links sperren den Zugriff aus dem Browser oft. In der URL „?dl=0“ durch „?dl=1“ ersetzen oder die Datei herunterladen und hochladen.',
	unknownError: 'Unbekannter Fehler',

	waitingForData: 'Noch keine Daten',
	waitingForFiles: 'Noch keine Dateien',
	fileCount: '{count} Dateien',
	duplicateFilesTitle: 'Doppelte Dateinamen',
	duplicatePathsOne: 'Dieser Pfad kommt mehrfach vor:',
	duplicatePathsOther: 'Diese Pfade kommen mehrfach vor:',
	duplicateFilesHint:
		'Ausgaben in der Grasshopper-Definition umbenennen, damit jede Datei einen eindeutigen Namen hat.',
	downloadFile: 'Datei herunterladen',
	downloadFiles: '{count} Dateien herunterladen',
	downloading: 'Wird heruntergeladen…',
	downloadFailed: 'Download fehlgeschlagen',
	copy: 'Kopieren',
	copied: 'Kopiert!',
	chartReceiving: 'Diagrammdaten werden empfangen…',
	chartRenderFailed: 'Diagramm konnte nicht dargestellt werden',
	fullscreenUnavailable: 'Vollbild nicht verfügbar: {error}',
	exitFullscreenFailed: 'Vollbild konnte nicht beendet werden: {error}',

	imageViewer: 'Bildbetrachter',
	imageLoading: 'Bild wird geladen…',
	imageUnsupported: 'Bildformat nicht unterstützt: {ext}. Unterstützt: {formats}',
	imageUnknownFormat: '(unbekannt)',
	imageDecodeFailed: '{file} konnte nicht gelesen werden',
	previousImage: 'Vorheriges Bild',
	nextImage: 'Nächstes Bild',
	zoomHint: 'Zum Zoomen Strg oder ⌘ halten und scrollen',
	zoomIn: 'Vergrössern',
	zoomOut: 'Verkleinern',
	zoomFit: 'Einpassen',
	zoomActual: 'Originalgrösse',
	downloadImage: 'Bild herunterladen'
};

export const VIEWER_MESSAGES: Record<Locale, ViewerMessages> = { en, de };

export const DEFAULT_LOCALE: Locale = 'en';

/** Resolve a catalog for a locale, falling back to English for unknown locales. */
export function messagesFor(locale: Locale | undefined): ViewerMessages {
	return VIEWER_MESSAGES[locale ?? DEFAULT_LOCALE] ?? VIEWER_MESSAGES[DEFAULT_LOCALE];
}

/** Layers a host's partial overrides over a full catalog. An `undefined` entry keeps the base string. */
export function withOverrides(
	base: ViewerMessages,
	overrides: Partial<ViewerMessages> | undefined
): ViewerMessages {
	if (!overrides) return base;
	const merged = { ...base };
	for (const [key, value] of Object.entries(overrides) as [keyof ViewerMessages, string][]) {
		if (value !== undefined) merged[key] = value;
	}
	return merged;
}

/** Fills each `{name}` placeholder from `vars`; an unknown placeholder is left as written. */
export function formatMessage(template: string, vars: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
		name in vars ? String(vars[name]) : placeholder
	);
}

/** Picks the singular or plural form for `count` and fills its `{count}`. */
export function formatCount(count: number, one: string, other: string): string {
	return formatMessage(count === 1 ? one : other, { count });
}
