<script lang="ts">
	import '../app.css';
	import { ModeWatcher, setMode } from 'mode-watcher';
	import {
		Toaster,
		toast,
		initializeFooterContext,
		setBlobSaver,
		setFilePicker,
		setHostContext
	} from '@selvajs/ui';
	import { onMount } from 'svelte';
	import { getSessionIdFromUrl, getWebSocketPortFromUrl, isRhinoPanel } from '$lib/utils/session';
	import { rememberBridgeSecret } from '$lib/websocket/bridge-secret';
	import { MAX_HOST_FILE_BYTES } from '$lib/websocket/bridge-handshake';
	import { createHostFilesClient } from '$lib/websocket/host-files-client';
	import { createGeometryPicksClient } from '$lib/websocket/geometry-picks-client';
	import { getWebSocketState } from '$lib/websocket/websocket.svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import HostWindowToggle from '$lib/components/HostWindowToggle.svelte';
	import { RHINO_PANEL_HOST } from '$lib/app.config';

	const footer = initializeFooterContext();

	// This page always solves in the user's own Grasshopper, in a browser tab too, so geometry
	// inputs and buttons render. Picks and presses go to the plugin; their results never come
	// back as form values.
	const hostSocket = getWebSocketState(getWebSocketPortFromUrl());
	const geometryPicks = createGeometryPicksClient(hostSocket, getSessionIdFromUrl);
	setHostContext({
		host: 'rhino',
		pickGeometry: geometryPicks.pickGeometry,
		clearGeometry: geometryPicks.clearGeometry,
		trigger: (paramId) => hostSocket.sendTrigger(getSessionIdFromUrl(), paramId)
	});

	let { children } = $props();

	// Not in onMount: the router can't replace history until hydration has finished. Even here the
	// first call runs just before the router counts as started, and a dev build throws then, which
	// aborts startup and makes the next navigation mount a second copy of the app. Hence the microtask.
	afterNavigate(() => {
		const sessionId = getSessionIdFromUrl();
		if (sessionId && rememberBridgeSecret(sessionId)) {
			queueMicrotask(() => replaceState(page.url.pathname + page.url.search, page.state));
		}
	});

	onMount(() => {
		if (isRhinoPanel()) {
			// The WebView reports Rhino's appearance as the system colour scheme.
			setMode('system');
			document.documentElement.dataset.host = RHINO_PANEL_HOST;

			footer.register({
				id: 'host-window-toggle',
				component: HostWindowToggle,
				getProps: () => ({}),
				position: 'right'
			});

			// The panel's WebView replaces the app with a downloaded file and can crash Rhino
			// from a file picker, so saves and picks go to the plugin's native dialogs instead.
			const hostFiles = createHostFilesClient(hostSocket, getSessionIdFromUrl, MAX_HOST_FILE_BYTES);
			setBlobSaver((blob, fileName) =>
				hostFiles.saveBlob(blob, fileName).catch((error: Error) => {
					toast.error(error.message);
					return false;
				})
			);
			setFilePicker((options) =>
				hostFiles.pickFile(options).catch((error: Error) => {
					toast.error(error.message);
					return null;
				})
			);
		}

		const handleRuntimeMessage = (event: CustomEvent<{ level: string; message: string }>) => {
			const { level, message } = event.detail;

			switch (level) {
				case 'error':
					toast.error(message);
					break;
				case 'warning':
					toast.warning(message);
					break;
				case 'info':
				case 'remark':
					toast.info(message);
					break;
				default:
					toast(message);
			}
		};

		// In the Rhino panel an Esc the page leaves unhandled goes on to Rhino, which moves focus
		// out of the panel. Marking it handled keeps focus here. Grasshopper's solve abort reads
		// the key's state rather than the event, so Esc still aborts a solve.
		const keepEscapeInPanel = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && isRhinoPanel()) event.preventDefault();
		};

		window.addEventListener('grasshopper-runtime-message', handleRuntimeMessage as EventListener);
		window.addEventListener('keydown', keepEscapeInPanel);

		return () => {
			window.removeEventListener(
				'grasshopper-runtime-message',
				handleRuntimeMessage as EventListener
			);
			window.removeEventListener('keydown', keepEscapeInPanel);
		};
	});
</script>

<ModeWatcher />
<Toaster />
{@render children?.()}
