<script lang="ts">
	import { getDocsSidebar } from '$lib/docs';

	const sidebar = getDocsSidebar();
</script>

<svelte:head>
	<title>Docs · Selva</title>
</svelte:head>

<h1>Documentation</h1>
<p class="lead">
	Guides for installing, configuring, and deploying Selva. Sourced directly from the repository.
</p>

{#each sidebar as group (group.title)}
	<h2>{group.title}</h2>
	<ul>
		{#each group.links as link (link.href)}
			<li><a href={link.href}>{link.label}</a></li>
		{/each}
	</ul>
{/each}

{#if sidebar.length === 0}
	<p>No published docs yet.</p>
{/if}
