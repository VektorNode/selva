<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button, PageContent, EmptyState } from '@selvajs/ui';
	import { ArrowRight, LayoutGrid, Star } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selvajs/platform';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import DefinitionCard from '$lib/components/definitions/DefinitionCard.svelte';
	import { formatRelative } from '$lib/format/relativeTime';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const isAuthed = $derived(!!page.data.user);
	const branding = $derived(page.data.branding);
	const dashboard = $derived(data.dashboard);

	const greetingName = $derived(
		page.data.profile?.displayName ?? page.data.user?.email?.split('@')[0] ?? ''
	);

	const projectList = $derived(Object.values(dashboard?.projects ?? {}));

	let loadingGuid = $state<string | null>(null);

	function open(guid: string) {
		loadingGuid = guid;
		goto(`/library/${guid}`).catch(() => {
			loadingGuid = null;
		});
	}

	function projectName(record: DefinitionRecord) {
		return projectList.length > 1 ? dashboard?.projects[record.projectId]?.name : undefined;
	}
</script>

<svelte:head>
	<title>{branding.name}</title>
</svelte:head>

<AppHeader>
	{#if isAuthed}
		<PageContent class="mx-auto w-full max-w-6xl space-y-10">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">
					{greetingName ? `Welcome back, ${greetingName}` : 'Welcome back'}
				</h1>
				<p class="text-muted-foreground mt-1 text-sm">{branding.tagline}</p>
			</div>

			{#if dashboard && dashboard.recentRuns.length > 0}
				<section>
					<div class="mb-3 flex items-baseline justify-between">
						<span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
							Pick up where you left off
						</span>
					</div>
					<div class="border-border bg-card overflow-hidden rounded-md border">
						{#each dashboard.recentRuns as run, i (run.runId)}
							<button
								onclick={() => open(run.definitionId)}
								disabled={loadingGuid === run.definitionId}
								class={`group hover:bg-muted/40 grid w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
									i < dashboard.recentRuns.length - 1 ? 'border-border border-b' : ''
								}`}
								style="grid-template-columns: 1fr 120px auto"
							>
								<span class="truncate font-medium">{run.definitionName}</span>
								<span class="text-muted-foreground font-mono text-xs">
									{formatRelative(run.timestamp)}
								</span>
								<span
									class="flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100"
								>
									Resume <ArrowRight class="h-3 w-3" />
								</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			{#if dashboard && dashboard.starred.length > 0}
				<section>
					<div class="mb-3 flex items-baseline justify-between">
						<span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
							Starred
						</span>
						<a href="/library" class="text-muted-foreground hover:text-foreground text-xs">
							View library
						</a>
					</div>
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each dashboard.starred as record (record.guid)}
							<DefinitionCard
								{record}
								starred
								loading={loadingGuid === record.guid}
								projectName={projectName(record)}
								onOpen={(r) => open(r.guid)}
							/>
						{/each}
					</div>
				</section>
			{/if}

			{#if dashboard && dashboard.recentRuns.length === 0 && dashboard.starred.length === 0}
				<EmptyState
					icon={dashboard.visibleCount > 0 ? LayoutGrid : Star}
					title={dashboard.visibleCount > 0 ? 'Nothing pinned yet' : 'No tools available yet'}
					description={dashboard.visibleCount > 0
						? 'Star a definition in the library and it will show up here.'
						: 'Once a definition is published to a project you can reach, it appears here.'}
				>
					{#snippet actions()}
						<Button href="/library">Browse library</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<div>
					<Button href="/library" variant="outline">
						Browse all Definitions <ArrowRight class="ml-1 h-4 w-4" />
					</Button>
				</div>
			{/if}
		</PageContent>
	{:else}
		<div class="flex flex-1 flex-col items-center justify-center px-4 text-center">
			<div class="max-w-md space-y-6">
				<h1 class="text-4xl font-bold tracking-tight">{branding.name}</h1>
				<p class="text-muted-foreground text-lg">{branding.tagline}</p>
				<div class="flex justify-center gap-3">
					<Button href="/login">Sign in</Button>
				</div>
			</div>
		</div>
	{/if}
</AppHeader>
