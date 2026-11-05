<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { updated } from '$app/state';
	import { initializeFooterContext, Toaster, toast } from '@selvajs/ui';

	let { data, children } = $props();

	initializeFooterContext();

	// Kit polls for a new build and checks on navigation and tab focus. Until a reload, this
	// tab runs the old client against the new server.
	let updateNoticeShown = false;
	$effect(() => {
		if (!updated.current || updateNoticeShown) return;
		updateNoticeShown = true;
		toast.info('Selva has been updated', {
			description: 'Reload to use the new version.',
			duration: Number.POSITIVE_INFINITY,
			action: { label: 'Reload', onClick: () => location.reload() }
		});
	});
</script>

<svelte:head>
	<title>{data.branding.name}</title>
	<meta name="description" content={data.branding.description} />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher />
<Toaster />
{@render children?.()}
