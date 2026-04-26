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
	class="inset-0 bg-black/30 fixed z-50"
	onclick={onClose}
	onkeydown={handleKey}
></div>
<div
	class="animate-in slide-in-from-right-4 top-0 right-0 fixed z-50 flex h-full border-border bg-background {width} flex-col overflow-y-auto border-l duration-150"
>
	{@render children()}
</div>
