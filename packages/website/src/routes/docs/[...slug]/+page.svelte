<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	let { data } = $props();
	const Content = $derived(data.content);
</script>

<svelte:head>
	<title>{data.title} · Selva Docs</title>
</svelte:head>

<Content />

<!-- Prev / next, in reading order. Sits outside the article prose so it isn't
     styled as body copy. -->
{#if data.prev || data.next}
	<nav class="not-prose border-border mt-16 grid gap-4 border-t pt-8 sm:grid-cols-2">
		{#if data.prev}
			<a
				href={`/docs/${data.prev.slug}`}
				class="group border-border hover:border-muted-foreground/40 hover:bg-muted/40 flex flex-col rounded-lg border p-4 transition"
			>
				<span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
					<ArrowLeft class="size-3.5" /> Previous
				</span>
				<span class="text-foreground group-hover:text-primary mt-1 font-medium transition"
					>{data.prev.title}</span
				>
			</a>
		{:else}
			<span></span>
		{/if}
		{#if data.next}
			<a
				href={`/docs/${data.next.slug}`}
				class="group border-border hover:border-muted-foreground/40 hover:bg-muted/40 flex flex-col rounded-lg border p-4 text-right transition"
			>
				<span class="text-muted-foreground inline-flex items-center justify-end gap-1 text-xs">
					Next <ArrowRight class="size-3.5" />
				</span>
				<span class="text-foreground group-hover:text-primary mt-1 font-medium transition"
					>{data.next.title}</span
				>
			</a>
		{/if}
	</nav>
{/if}
