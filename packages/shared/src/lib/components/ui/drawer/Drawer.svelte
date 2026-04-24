<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		onClose: () => void;
		width?: string;
		ariaLabel?: string;
		children: Snippet;
	}

	let { onClose, width = 'w-125', ariaLabel = 'Close drawer', children }: Props = $props();

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKey} />

<div
	role="button"
	tabindex="-1"
	aria-label={ariaLabel}
	class="fixed inset-0 z-50 bg-black/30"
	onclick={onClose}
	onkeydown={handleKey}
></div>
<div
	class="border-border bg-background animate-in slide-in-from-right-4 fixed top-0 right-0 z-50 flex h-full {width} flex-col overflow-y-auto border-l duration-150"
>
	{@render children()}
</div>
