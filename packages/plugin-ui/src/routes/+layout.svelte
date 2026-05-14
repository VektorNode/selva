<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster, toast, initializeFooterContext } from '@selvajs/ui';
	import { onMount } from 'svelte';

	initializeFooterContext();

	let { children } = $props();

	onMount(() => {
		// Listen for runtime messages from Grasshopper
		const handleRuntimeMessage = (event: CustomEvent<{ level: string; message: string }>) => {
			const { level, message } = event.detail;

			// Map Grasshopper message levels to toast methods
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
