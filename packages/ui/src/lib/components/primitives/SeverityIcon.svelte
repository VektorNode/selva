<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { SEVERITY_ICON, SEVERITY_TEXT, type Severity } from './severity';

	interface Props {
		severity: Severity;
		class?: string;
	}

	let { severity, class: className }: Props = $props();

	const Icon = $derived(SEVERITY_ICON[severity]);
</script>

<Icon class={cn('size-4 shrink-0', SEVERITY_TEXT[severity], className)} aria-hidden="true" />
