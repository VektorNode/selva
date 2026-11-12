// Reactive shell over app-export-core.ts: owns the $state and supplies the socket's export client
// and the host's file saver.

import { pickFile, saveBlob, toast } from '@selvajs/ui';
import { blobToDataUri, drawIconPng } from '#lib/features/builder/image-encode.js';
import { getSessionIdFromUrl, getWebSocketPortFromUrl } from '#lib/utils/session.js';
import { getWebSocketState, type WebSocketState } from '#lib/websocket/websocket.svelte.js';
import { createAppExportClient, type AppExportClient } from '#lib/websocket/app-export-client.js';
import {
	APP_ICON_PX,
	MAX_APP_ICON_BYTES,
	closeDialog,
	createInitialAppExportState,
	exportBlocker,
	openDialog,
	startExport,
	type AppExportDeps
} from './app-export-core';

interface Options {
	isSchemaDirty: () => boolean;
}

// One client per socket, not per builder visit: a client's reply handlers stay on the socket.
const clients = new WeakMap<WebSocketState, AppExportClient>();

function clientFor(socket: WebSocketState): AppExportClient {
	let client = clients.get(socket);
	if (!client) clients.set(socket, (client = createAppExportClient(socket, getSessionIdFromUrl)));
	return client;
}

export function useAppExport(options: Options) {
	const state = $state(createInitialAppExportState());
	const socket = getWebSocketState(getWebSocketPortFromUrl());

	const deps: AppExportDeps = {
		exporter: clientFor(socket),
		save: saveBlob,
		notify: toast,
		isSchemaDirty: options.isSchemaDirty
	};

	return {
		get state() {
			return state;
		},
		get blocker() {
			return exportBlocker(state, deps);
		},
		/** The plugin answers the export; without it the builder shows no Export as app. */
		get available() {
			return socket.canExportApp;
		},
		open: (defaultName: string) => openDialog(state, defaultName),
		/** Asks for an image and keeps it as the app's icon. A cancelled pick changes nothing. */
		async pickIcon() {
			const file = await pickFile({ accept: 'image/*,.svg' });
			if (!file) return;
			try {
				const png = await drawIconPng(file, APP_ICON_PX);
				if (png.size > MAX_APP_ICON_BYTES) {
					toast.error(
						`That image is ${Math.round(png.size / 1024)} KB as a ${APP_ICON_PX} px icon; icons must ` +
							`stay under ${MAX_APP_ICON_BYTES / 1024} KB. Try a simpler image.`
					);
					return;
				}
				const dataUri = await blobToDataUri(png);
				state.icon = dataUri.slice(dataUri.indexOf(',') + 1);
			} catch {
				toast.error(`${file.name} could not be read as an image.`);
			}
		},
		close: () => closeDialog(state),
		exportApp: () => startExport(state, deps)
	};
}

export type AppExport = ReturnType<typeof useAppExport>;
