<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '@selva/shared';

	let { children } = $props();
</script>

<ModeWatcher />
<Toaster />
{@render children?.()}
