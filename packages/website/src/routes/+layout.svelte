<script lang="ts">
	import '../app.css';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children } = $props();
</script>

<div class="bg-background text-foreground flex min-h-screen flex-col">
	<Header />
	<div class="flex-1">
		{@render children()}
	</div>
	<Footer />
</div>
