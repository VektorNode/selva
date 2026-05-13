<script lang="ts">
	interface Props {
		name: string;
		size?: 'sm' | 'md';
	}

	let { name, size = 'md' }: Props = $props();

	const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
	const dim = $derived(size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm');
</script>

<span
	class={`bg-accent text-accent-foreground flex shrink-0 items-center justify-center rounded-full font-medium ${dim}`}
	aria-hidden="true"
>
	{initial}
</span>
