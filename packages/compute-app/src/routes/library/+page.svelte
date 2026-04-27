<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { Search, toast, PageHeader, PageContent, SectionHeader } from '@selvajs/ui';
	import { ArrowRight, Filter as FilterIcon, X } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selvajs/platform';
	import type { PageData } from './$types';
	import DefinitionCard from '$lib/components/definitions/DefinitionCard.svelte';
	import ToolListView from './_components/ToolListView.svelte';
	import ViewToggle from './_components/ViewToggle.svelte';
	import { formatRelative } from './_components/toolStyles';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';

	type ViewMode = 'grid' | 'list';

	let { data }: { data: PageData } = $props();

	// ============================================================================
	// State
	// ============================================================================
	let searchQuery = $state('');
	let activeProjectId = $state<string | null>(null);
	let activeCategory = $state<string | null>(null);
	let activeTag = $state<string | null>(null);
	let viewMode = $state<ViewMode>('grid');
	let loadingGuid = $state<string | null>(null);
	let starBusyGuid = $state<string | null>(null);
	let showFilters = $state(false);

	// Client-side starred set so optimistic toggles feel instant.
	const starredIds = $derived(new Set(data.starredRecords.map((r) => r.guid)));

	// ============================================================================
	// Derived lists
	// ============================================================================
	const allRecords = $derived<DefinitionRecord[]>([...data.starredRecords, ...data.records]);

	const projectsWithDefinitions = $derived(new Set(allRecords.map((r) => r.projectId)));

	const projectList = $derived(
		Object.values(data.projects).filter((p) => projectsWithDefinitions.has(p.id))
	);

	const availableCategories = $derived(
		Array.from(new Set(allRecords.map((r) => r.category).filter((c): c is string => !!c))).sort()
	);

	const availableTags = $derived(
		Array.from(new Set(allRecords.flatMap((r) => r.tags ?? []))).sort()
	);

	function projectName(id: string) {
		return data.projects[id]?.name ?? '';
	}

	function matches(r: DefinitionRecord): boolean {
		if (activeProjectId && r.projectId !== activeProjectId) return false;
		if (activeCategory && r.category !== activeCategory) return false;
		if (activeTag && !(r.tags ?? []).includes(activeTag)) return false;
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			const hay = [r.displayName, r.description, r.category, ...(r.tags ?? [])]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	}

	const filteredRecords = $derived(allRecords.filter(matches));

	const activeFilterCount = $derived(
		[activeProjectId, activeCategory, activeTag].filter((v) => v !== null).length
	);
	const hasAnyFilter = $derived(searchQuery.trim() !== '' || activeFilterCount > 0);

	// ============================================================================
	// Actions
	// ============================================================================
	function open(guid: string) {
		loadingGuid = guid;
		goto(`/library/${guid}`).catch(() => {
			loadingGuid = null;
		});
	}

	async function toggleStar(guid: string) {
		starBusyGuid = guid;
		const isStarred = starredIds.has(guid);
		try {
			const res = await fetch(`/api/me/starred/${guid}`, {
				method: isStarred ? 'DELETE' : 'POST'
			});
			if (!res.ok) throw new Error(`${res.status}`);
			await invalidateAll();
		} catch {
			toast.error(isStarred ? 'Failed to unstar' : 'Failed to star');
		} finally {
			starBusyGuid = null;
		}
	}

	function clearFilters() {
		searchQuery = '';
		activeProjectId = null;
		activeCategory = null;
		activeTag = null;
		showFilters = false;
	}
</script>

<PageHeader homeUrl="/library">
	{#snippet navItems()}
		<MainNav />
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
		<SettingsMenu
			platformPermissions={data.user?.platformPermissions ?? []}
			orgPermissions={data.ctx?.orgPermissions ?? []}
		/>
	{/snippet}
</PageHeader>

<PageContent>
	<div class="space-y-6">
		<SectionHeader
			eyebrow="Workspace"
			title="Library"
			description={`${filteredRecords.length} tool${filteredRecords.length === 1 ? '' : 's'}${
				projectList.length > 0
					? ` across ${projectList.length} project${projectList.length === 1 ? '' : 's'}`
					: ''
			}.`}
		>
			{#snippet actions()}
				<ViewToggle mode={viewMode} onChange={(m) => (viewMode = m)} />
			{/snippet}
		</SectionHeader>

		<!-- Search + filter bar -->
		<div class="flex flex-wrap items-center gap-2">
			<div class="min-w-60 flex-1">
				<Search
					bind:value={searchQuery}
					placeholder="Search tools, descriptions, tags…"
					clearable
					class="h-9 rounded-md text-sm"
				/>
			</div>

			{#if availableCategories.length > 0 || availableTags.length > 0 || projectList.length > 1}
				<button
					type="button"
					onclick={() => (showFilters = !showFilters)}
					class={`relative inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${
						showFilters || activeFilterCount > 0
							? 'border-border bg-accent text-accent-foreground'
							: 'border-input bg-background text-foreground hover:bg-muted/40'
					}`}
				>
					<FilterIcon class="h-3.5 w-3.5" />
					Filters
					{#if activeFilterCount > 0}
						<span
							class="rounded-full bg-primary px-1.5 py-px font-mono text-[10px] text-primary-foreground"
						>
							{activeFilterCount}
						</span>
					{/if}
				</button>
			{/if}

			{#if hasAnyFilter}
				<button
					type="button"
					onclick={clearFilters}
					class="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="h-3 w-3" />
					Clear
				</button>
			{/if}
		</div>

		{#if showFilters}
			<div class="rounded-md border border-border bg-card p-4">
				<div class="grid gap-4 sm:grid-cols-3">
					{#if projectList.length > 1}
						<div class="space-y-1.5">
							<label class="text-xs font-medium text-muted-foreground" for="filter-project">
								Project
							</label>
							<select
								id="filter-project"
								bind:value={activeProjectId}
								class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value={null}>All projects</option>
								{#each projectList as p (p.id)}
									<option value={p.id}>{p.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if availableCategories.length > 0}
						<div class="space-y-1.5">
							<label class="text-xs font-medium text-muted-foreground" for="filter-category">
								Category
							</label>
							<select
								id="filter-category"
								bind:value={activeCategory}
								class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value={null}>All categories</option>
								{#each availableCategories as cat (cat)}
									<option value={cat}>{cat}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if availableTags.length > 0}
						<div class="space-y-1.5">
							<label class="text-xs font-medium text-muted-foreground" for="filter-tag">
								Tag
							</label>
							<select
								id="filter-tag"
								bind:value={activeTag}
								class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value={null}>All tags</option>
								{#each availableTags as tag (tag)}
									<option value={tag}>#{tag}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Recent runs (only with no filters) -->
		{#if data.recentRuns.length > 0 && !hasAnyFilter}
			<section>
				<div class="mb-3 flex items-baseline justify-between">
					<span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Recent runs
					</span>
					<span class="text-xs text-muted-foreground">Resume where you left off</span>
				</div>
				<div class="overflow-hidden rounded-md border border-border bg-card">
					{#each data.recentRuns.slice(0, 5) as run, i (run.runId)}
						<button
							onclick={() => open(run.definitionId)}
							disabled={loadingGuid === run.definitionId}
							class={`group grid w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60 ${
								i < Math.min(data.recentRuns.length, 5) - 1 ? 'border-b border-border' : ''
							}`}
							style="grid-template-columns: 1fr 120px auto"
						>
							<span class="truncate font-medium">{run.definitionName}</span>
							<span class="font-mono text-xs text-muted-foreground">
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

		<!-- Tool grid (flat — no per-project sectioning) -->
		{#if filteredRecords.length > 0}
			{#if viewMode === 'grid'}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each filteredRecords as record (record.guid)}
						<DefinitionCard
							{record}
							starred={starredIds.has(record.guid)}
							loading={loadingGuid === record.guid}
							starBusy={starBusyGuid === record.guid}
							projectName={projectList.length > 1 ? projectName(record.projectId) : undefined}
							onOpen={(r) => open(r.guid)}
							onToggleStar={toggleStar}
						/>
					{/each}
				</div>
			{:else}
				<ToolListView
					records={filteredRecords}
					{starredIds}
					{loadingGuid}
					{starBusyGuid}
					onOpen={open}
					onToggleStar={toggleStar}
				/>
			{/if}
		{:else}
			<!-- Empty state -->
			<div
				class="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-border py-20 text-center"
			>
				{#if hasAnyFilter}
					<p class="text-sm font-medium">No tools match your filters</p>
					<button
						class="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
						onclick={clearFilters}
					>
						Clear all filters
					</button>
				{:else}
					<p class="text-sm font-medium">No tools available yet</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Ask an admin to publish a Grasshopper definition.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</PageContent>
