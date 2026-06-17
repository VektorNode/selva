<script lang="ts">
	let { data } = $props();
	const Content = $derived(data.content);
</script>

<svelte:head>
	<title>{data.title} · Selva Docs</title>
</svelte:head>

<Content />
