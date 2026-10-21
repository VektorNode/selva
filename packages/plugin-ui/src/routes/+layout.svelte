<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster, toast, initializeFooterContext } from '@selvajs/ui';
	import { onMount } from 'svelte';
	import { getSessionIdFromUrl } from '$lib/utils/session';
	import { rememberBridgeSecret } from '$lib/websocket/bridge-secret';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';

	initializeFooterContext();

	let { children } = $props();

	// Not in onMount: the router can't replace history until hydration has finished.
	afterNavigate(() => {
		const sessionId = getSessionIdFromUrl();
		if (sessionId && rememberBridgeSecret(sessionId)) {
			replaceState(page.url.pathname + page.url.search, page.state);
		}
	});

	onMount(() => {
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

		window.addEventListener('grasshopper-runtime-message', handleRuntimeMessage as EventListener);

		return () => {
			window.removeEventListener(
				'grasshopper-runtime-message',
				handleRuntimeMessage as EventListener
			);
		};
	});
</script>

<ModeWatcher />
<Toaster />
{@render children?.()}
