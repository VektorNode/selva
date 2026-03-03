<script lang="ts">
	import { Circle } from '@lucide/svelte';

	interface Props {
		status: 'ok' | 'warning' | 'error' | 'checking';
		message?: string;
	}

	let { status, message }: Props = $props();

	const statusConfig = {
		ok: { label: 'Compute Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Compute Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Compute Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking...', color: 'text-blue-600 dark:text-blue-400' }
	};

	const config = $derived(statusConfig[status]);
</script>

<div class="flex items-center gap-1.5" title={message}>
	<Circle class="h-2.5 w-2.5 shrink-0 fill-current {config.color}" />
	<span class="text-xs {config.color}">{config.label}</span>
</div>
