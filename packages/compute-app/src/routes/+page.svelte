<script lang="ts">
	import { Button, PageHeader } from 'selva-shared';
</script>

<svelte:head>
	<title>Selva</title>
</svelte:head>

<PageHeader showModeToggle={true}>
	{#snippet rightContent()}
		<Button href="/login" size="sm">Sign in</Button>
	{/snippet}
</PageHeader>

<div class="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center px-4 text-center">
	<div class="max-w-md space-y-6">
		<h1 class="text-4xl font-bold tracking-tight">Selva</h1>
		<p class="text-muted-foreground text-lg">
			Turn Grasshopper definitions into tools anyone can use.
		</p>
		<div class="flex justify-center gap-3">
			<Button href="/app">Sign in</Button>
		</div>
	</div>
</div>
