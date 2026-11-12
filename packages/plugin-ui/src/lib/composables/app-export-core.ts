// Pure transition logic for the "Export as app" dialog. No runes, no toast, no socket: every
// function works on a plain AppExportState plus a `deps` bag. useAppExport.svelte.ts owns the
// $state and supplies the real exporter and saver.

export const APP_FILE_EXTENSION = '.slvx';

/** The plugin stores the name in at most 512 UTF-8 bytes; this many characters always fit. */
export const APP_NAME_MAX = 100;

/** The app's window icon is stored at this size, square. */
export const APP_ICON_PX = 256;
/** What the plugin accepts for the icon's PNG. */
export const MAX_APP_ICON_BYTES = 256 * 1024;

export interface AppExportState {
	open: boolean;
	/** Shown as the app's window title, and the file's name once sanitized. */
	name: string;
	/** Empty exports the app unprotected. */
	key: string;
	/** The key field shows its text. */
	keyShown: boolean;
	/** The app's window icon as a base64 PNG; null uses Selva's. Kept between openings. */
	icon: string | null;
	exporting: boolean;
	/** Why the last export produced no file. */
	error: string | null;
}

export interface AppExportDeps {
	exporter: {
		readonly connected: boolean;
		/** Rejects with an Error whose message is for the user. */
		exportApp(name: string, key: string, icon: string | null): Promise<Blob>;
	};
	/** Resolves false when the user cancelled the save. */
	save: (blob: Blob, fileName: string) => Promise<boolean>;
	notify: { success(message: string): void; error(message: string): void };
	/** The app shows the schema saved in the definition, so an unsaved one would ship stale. */
	isSchemaDirty: () => boolean;
}

export function createInitialAppExportState(): AppExportState {
	return {
		open: false,
		name: '',
		key: '',
		keyShown: false,
		icon: null,
		exporting: false,
		error: null
	};
}

// Characters Windows refuses in a file name; macOS and Linux refuse a subset.
const FORBIDDEN_IN_FILE_NAMES = '<>:"/\\|?*';

/** The name as a file name: Windows also refuses control characters and a trailing dot or space. */
export function appFileName(name: string): string {
	const cleaned = [...name]
		.filter((char) => char.charCodeAt(0) >= 32 && !FORBIDDEN_IN_FILE_NAMES.includes(char))
		.join('')
		.replace(/[. ]+$/, '')
		.trim();
	return `${cleaned || 'app'}${APP_FILE_EXTENSION}`;
}

/** Why Export can't run right now, or null when it can. */
export function exportBlocker(state: AppExportState, deps: AppExportDeps): string | null {
	if (!deps.exporter.connected) return 'Not connected to Grasshopper.';
	if (deps.isSchemaDirty()) return 'Save the schema first.';
	if (state.exporting) return 'Already exporting.';
	const name = state.name.trim();
	if (!name) return 'Give the app a name.';
	if (name.length > APP_NAME_MAX) return `App names are at most ${APP_NAME_MAX} characters.`;
	return null;
}

/** Every opening starts from the schema's name and no key, unless an export is still running. */
export function openDialog(state: AppExportState, defaultName: string): void {
	state.open = true;
	if (state.exporting) return;
	state.name = defaultName;
	state.key = '';
	state.error = null;
}

/** An export keeps running with the dialog closed; a failure then arrives as a toast. */
export function closeDialog(state: AppExportState): void {
	state.open = false;
	// An export in flight already took the key, so nothing needs it once the dialog is gone.
	state.key = '';
	state.keyShown = false;
}

/** Resolves true when the file was saved. A cancelled save leaves the dialog as it was. */
export async function startExport(state: AppExportState, deps: AppExportDeps): Promise<boolean> {
	if (exportBlocker(state, deps)) return false;
	const name = state.name.trim();
	state.exporting = true;
	state.error = null;
	try {
		const file = await deps.exporter.exportApp(name, state.key, state.icon);
		const fileName = appFileName(name);
		if (!(await deps.save(file, fileName))) return false;
		closeDialog(state);
		deps.notify.success(`Exported ${fileName}.`);
		return true;
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'Could not export the app.';
		if (state.open) state.error = reason;
		else deps.notify.error(reason);
		return false;
	} finally {
		state.exporting = false;
	}
}
