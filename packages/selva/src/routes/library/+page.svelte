<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import {
		Search,
		toast,
		PageContent,
		SectionHeader,
		ViewToggle,
		EmptyState,
		FilterableDropdown
	} from '@selvajs/ui';
	import { ArrowRight, Filter as FilterIcon, X } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selvajs/platform';
	import type { PageData } from './$types';
	import DefinitionCard from '#lib/components/definitions/DefinitionCard.svelte';
	import ToolListView from './_components/ToolListView.svelte';
	import { formatRelative } from '#lib/format/relativeTime.js';
	import AppHeader from '#lib/components/AppHeader.svelte';

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

	function projectVisibility(id: string) {
		return data.projectMap[id]?.visibility;
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
			const res = await fetch(`/api/v1/me/starred/${guid}`, {
				method: isStarred ? 'DELETE' : 'PUT'
			});
			if (!res.ok) throw new Error(`${res.status}`);
			await refreshAll();
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

<AppHeader>
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
								? 'border-border bg-selected text-foreground'
								: 'border-input bg-background text-foreground hover:bg-hover'
						}`}
					>
						<FilterIcon class="h-3.5 w-3.5" />
						Filters
						{#if activeFilterCount > 0}
							<span
								class="bg-primary text-primary-foreground rounded-full px-1.5 py-px font-mono text-[10px]"
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
						class="text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs transition-colors"
					>
						<X class="h-3 w-3" />
						Clear
					</button>
				{/if}
			</div>

			{#if showFilters}
				<div class="border-border bg-card rounded-md border p-4">
					<div class="grid gap-4 sm:grid-cols-3">
						{#if projectList.length > 1}
							<div class="space-y-1.5">
								<label class="text-muted-foreground text-xs font-medium" for="filter-project">
									Project
								</label>
								<FilterableDropdown
									id="filter-project"
									items={[
										{ id: '', label: 'All projects' },
										...projectList.map((p) => ({ id: p.id, label: p.name }))
									]}
									value={activeProjectId ?? ''}
									onChange={(v) => (activeProjectId = v || null)}
									size="sm"
								/>
							</div>
						{/if}

						{#if availableCategories.length > 0}
							<div class="space-y-1.5">
								<label class="text-muted-foreground text-xs font-medium" for="filter-category">
									Category
								</label>
								<FilterableDropdown
									id="filter-category"
									items={[
										{ id: '', label: 'All categories' },
										...availableCategories.map((cat) => ({ id: cat, label: cat }))
									]}
									value={activeCategory ?? ''}
									onChange={(v) => (activeCategory = v || null)}
									size="sm"
								/>
							</div>
						{/if}

						{#if availableTags.length > 0}
							<div class="space-y-1.5">
								<label class="text-muted-foreground text-xs font-medium" for="filter-tag">
									Tag
								</label>
								<FilterableDropdown
									id="filter-tag"
									items={[
										{ id: '', label: 'All tags' },
										...availableTags.map((tag) => ({ id: tag, label: `#${tag}` }))
									]}
									value={activeTag ?? ''}
									onChange={(v) => (activeTag = v || null)}
									size="sm"
								/>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Recent runs (only with no filters) -->
			{#if data.recentRuns.length > 0 && !hasAnyFilter}
				<section>
					<div class="mb-3 flex items-baseline justify-between">
						<span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
							Recent runs
						</span>
						<span class="text-muted-foreground text-xs">Resume where you left off</span>
					</div>
					<div class="border-border bg-card overflow-hidden rounded-md border">
						{#each data.recentRuns.slice(0, 5) as run, i (run.runId)}
							<button
								onclick={() => open(run.definitionId)}
								disabled={loadingGuid === run.definitionId}
								class={`group hover:bg-hover grid w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
									i < Math.min(data.recentRuns.length, 5) - 1 ? 'border-border border-b' : ''
								}`}
								style="grid-template-columns: minmax(0, 1fr) auto auto"
							>
								<span class="truncate font-medium">{run.definitionName}</span>
								<span class="text-muted-foreground font-mono text-xs">
									{formatRelative(run.timestamp)}
								</span>
								<span
									class="flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100"
								>
									<span class="hidden sm:inline">Resume</span>
									<ArrowRight class="h-3 w-3" />
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
								projectVisibility={projectList.length > 1
									? projectVisibility(record.projectId)
									: undefined}
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
			{:else if hasAnyFilter}
				<EmptyState size="lg" title="No tools match your filters">
					{#snippet actions()}
						<button
							class="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
							onclick={clearFilters}
						>
							Clear all filters
						</button>
					{/snippet}
				</EmptyState>
			{:else}
				<EmptyState
					size="lg"
					title="No tools available yet"
					description="Ask an admin to publish a Grasshopper definition."
				/>
			{/if}
		</div>
	</PageContent>
</AppHeader>
