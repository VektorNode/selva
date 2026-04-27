<script lang="ts">
	import { Button, PageHeader } from '@selvajs/shared';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	interface PageData {
		user?: { platformPermissions?: PlatformPermission[] } | null;
		ctx?: { orgPermissions?: OrgPermission[] } | null;
	}
	let { data }: { data: PageData } = $props();

	const isAuthed = $derived(!!data.user);
</script>

<svelte:head>
	<title>Selva</title>
</svelte:head>

<PageHeader homeUrl="/">
	{#snippet navItems()}
		{#if isAuthed}
			<MainNav />
		{/if}
	{/snippet}
	{#snippet rightContent()}
		{#if isAuthed}
			<UserChip />
			<SettingsMenu
				platformPermissions={data.user?.platformPermissions ?? []}
				orgPermissions={data.ctx?.orgPermissions ?? []}
			/>
		{:else}
			<Button href="/login" size="sm">Sign in</Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center px-4 text-center">
	<div class="max-w-md space-y-6">
		<h1 class="text-4xl font-bold tracking-tight">Selva</h1>
		<p class="text-lg text-muted-foreground">
			Turn Grasshopper definitions into tools anyone can use.
		</p>
		<div class="flex justify-center gap-3">
			{#if isAuthed}
				<Button href="/library">Open library</Button>
			{:else}
				<Button href="/login">Sign in</Button>
			{/if}
		</div>
	</div>
</div>
