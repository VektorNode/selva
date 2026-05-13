<script lang="ts">
	import { Star } from '@lucide/svelte';

	interface Props {
		starred: boolean;
		busy?: boolean;
		/** Overlay style sits on top of a cover image; chip style sits inline. */
		variant?: 'overlay' | 'chip';
		onToggle: () => void;
	}

	let { starred, busy = false, variant = 'overlay', onToggle }: Props = $props();

	const overlayBase =
		'absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-all disabled:opacity-60';
	const chipBase =
		'flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-60';
</script>

<button
	type="button"
	title={starred ? 'Unstar' : 'Star'}
	aria-label={starred ? 'Unstar definition' : 'Star definition'}
	aria-pressed={starred}
	disabled={busy}
	onclick={(e) => {
		e.stopPropagation();
		e.preventDefault();
		onToggle();
	}}
	class={variant === 'overlay'
		? `${overlayBase} ${starred ? 'bg-amber-400/90 text-white' : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/55'}`
		: `${chipBase} ${starred ? 'text-amber-500 hover:bg-amber-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
>
	<Star class="h-3.5 w-3.5 {starred ? 'fill-current' : ''}" />
</button>
