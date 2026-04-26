<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Search, toast, PageHeader, PageContent } from 'selva-shared';
	import { ArrowRight, ChevronDown } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selva/platform';
	import type { PageData } from './$types';
	import ToolCard from './_components/ToolCard.svelte';
	import ToolListView from './_components/ToolListView.svelte';
	import ViewToggle from './_components/ViewToggle.svelte';
	import { formatRelative } from './_components/toolStyles';
	import UserChip from '$lib/components/UserChip.svelte';

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
	let expandedProjects = $state<Set<string>>(new Set());
	let loadingGuid = $state<string | null>(null);
	let starBusyGuid = $state<string | null>(null);

	const PREVIEW_COUNT = 4;

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

	const hasAnyFilter = $derived(
		searchQuery.trim() !== '' ||
			activeProjectId !== null ||
			activeCategory !== null ||
			activeTag !== null
	);

	// Group by project, keeping only projects with at least one matching record.
	const grouped = $derived.by(() => {
		const byProject = new SvelteMap<string, DefinitionRecord[]>();
		for (const r of filteredRecords) {
			const list = byProject.get(r.projectId);
			if (list) list.push(r);
			else byProject.set(r.projectId, [r]);
		}
		// Order projects by the order they appear in data.projects, unknown ids last.
		const ordered: { id: string; name: string; records: DefinitionRecord[] }[] = [];
		for (const p of projectList) {
			const records = byProject.get(p.id);
			if (records && records.length > 0) {
				ordered.push({ id: p.id, name: p.name, records });
				byProject.delete(p.id);
			}
		}
		for (const [id, records] of byProject) {
			ordered.push({ id, name: data.projects[id]?.name ?? 'Unknown project', records });
		}
		return ordered;
	});

	// ============================================================================
	// Actions
	// ============================================================================
	function open(guid: string) {
		loadingGuid = guid;
		goto(`/app/${guid}`).catch(() => {
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

	function toggleExpanded(projectId: string) {
		const next = new SvelteSet(expandedProjects);
		if (next.has(projectId)) next.delete(projectId);
		else next.add(projectId);
		expandedProjects = next;
	}

	function clearFilters() {
		searchQuery = '';
		activeProjectId = null;
		activeCategory = null;
		activeTag = null;
	}
</script>

<PageHeader>
	{#snippet rightContent()}
		<UserChip />
	{/snippet}
</PageHeader>

<PageContent>
	<div class="mx-auto max-w-6xl px-6 pt-6 pb-20">
		<!-- ── Header ───────────────────────────────────────────────────── -->
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-lg font-semibold">Tools</h1>
			<span class="text-muted-foreground text-[12px]">
				{filteredRecords.length}
				{filteredRecords.length === 1 ? 'tool' : 'tools'}
				{#if hasAnyFilter}<button
						class="hover:text-foreground ml-2 underline underline-offset-2"
						onclick={clearFilters}>clear filters</button
					>{/if}
			</span>
			<div class="ml-auto">
				<ViewToggle mode={viewMode} onChange={(m) => (viewMode = m)} />
			</div>
		</div>

		<!-- ── Search + filter row ──────────────────────────────────────── -->
		<div class="mt-4 flex flex-wrap items-center gap-2">
			<Search
				bind:value={searchQuery}
				placeholder="Search tools, descriptions, tags…"
				clearable
				containerClass="min-w-[240px] flex-1"
				class="h-9 rounded-lg text-[13px]"
			/>

			{#if availableCategories.length > 1}
				<div class="relative">
					<select
						bind:value={activeCategory}
						class="border-border bg-card h-9 appearance-none rounded-lg border py-1 pr-8 pl-3 text-[13px]"
					>
						<option value={null}>All categories</option>
						{#each availableCategories as cat (cat)}
							<option value={cat}>{cat}</option>
						{/each}
					</select>
					<ChevronDown
						class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2"
					/>
				</div>
			{/if}

			{#if availableTags.length > 1}
				<div class="relative">
					<select
						bind:value={activeTag}
						class="border-border bg-card h-9 appearance-none rounded-lg border py-1 pr-8 pl-3 text-[13px]"
					>
						<option value={null}>All tags</option>
						{#each availableTags as tag (tag)}
							<option value={tag}>#{tag}</option>
						{/each}
					</select>
					<ChevronDown
						class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2"
					/>
				</div>
			{/if}
		</div>

		<!-- ── Project pills ────────────────────────────────────────────── -->
		{#if projectList.length > 1}
			<div class="mt-3 flex flex-wrap gap-1.5">
				<button
					onclick={() => (activeProjectId = null)}
					class="rounded-full px-3 py-1 text-[12px] transition-colors {activeProjectId === null
						? 'bg-foreground text-background'
						: 'bg-muted text-muted-foreground hover:text-foreground'}"
				>
					All projects
				</button>
				{#each projectList as p (p.id)}
					<button
						onclick={() => (activeProjectId = activeProjectId === p.id ? null : p.id)}
						class="rounded-full px-3 py-1 text-[12px] transition-colors {activeProjectId === p.id
							? 'bg-foreground text-background'
							: 'bg-muted text-muted-foreground hover:text-foreground'}"
					>
						{p.name}
					</button>
				{/each}
			</div>
		{/if}

		<!-- ── Recent runs (only with no filters) ───────────────────────── -->
		{#if data.recentRuns.length > 0 && !hasAnyFilter}
			<section class="mt-10">
				<div class="mb-3 flex items-baseline justify-between">
					<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
						Recent runs
					</span>
					<span class="text-muted-foreground text-[12px]">Resume where you left off</span>
				</div>
				<div class="border-border bg-card overflow-hidden rounded-xl border">
					{#each data.recentRuns.slice(0, 5) as run, i (run.runId)}
						<button
							onclick={() => open(run.definitionId)}
							disabled={loadingGuid === run.definitionId}
							class="hover:bg-muted/40 group grid w-full items-center gap-4 px-4 py-3 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60
							{i < Math.min(data.recentRuns.length, 5) - 1 ? 'border-border border-b' : ''}"
							style="grid-template-columns: 1fr 120px auto"
						>
							<span class="truncate font-semibold">{run.definitionName}</span>
							<span class="text-muted-foreground font-mono text-[12px]"
								>{formatRelative(run.timestamp)}</span
							>
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

		<!-- ── Grouped project sections ─────────────────────────────────── -->
		{#if grouped.length > 0}
			<div class="mt-10 space-y-10">
				{#each grouped as group (group.id)}
					{@const expanded = expandedProjects.has(group.id)}
					{@const visible = expanded ? group.records : group.records.slice(0, PREVIEW_COUNT)}
					{@const hidden = group.records.length - visible.length}

					<section>
						<div class="mb-3 flex items-baseline justify-between">
							<div class="flex items-baseline gap-2">
								<span class="text-[15px] font-semibold">{group.name}</span>
								<span class="text-muted-foreground text-[12px]">
									{group.records.length}
									{group.records.length === 1 ? 'tool' : 'tools'}
								</span>
							</div>
						</div>

						{#if viewMode === 'grid'}
							<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{#each visible as record (record.guid)}
									<ToolCard
										{record}
										starred={starredIds.has(record.guid)}
										loading={loadingGuid === record.guid}
										starBusy={starBusyGuid === record.guid}
										onOpen={open}
										onToggleStar={toggleStar}
									/>
								{/each}
							</div>
						{:else}
							<ToolListView
								records={visible}
								{starredIds}
								{loadingGuid}
								{starBusyGuid}
								onOpen={open}
								onToggleStar={toggleStar}
							/>
						{/if}

						{#if hidden > 0 || expanded}
							<div class="mt-3 flex justify-center">
								<button
									onclick={() => toggleExpanded(group.id)}
									class="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
								>
									{#if expanded}
										Show less
									{:else}
										Show all {group.records.length}
										<ArrowRight class="h-3 w-3" />
									{/if}
								</button>
							</div>
						{/if}
					</section>
				{/each}
			</div>
		{:else}
			<!-- ── Empty state ─────────────────────────────────────────────── -->
			<div class="flex flex-col items-center justify-center py-24 text-center">
				{#if hasAnyFilter}
					<p class="text-sm font-medium">No tools match your filters</p>
					<button
						class="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
						onclick={clearFilters}
					>
						Clear all filters
					</button>
				{:else}
					<p class="text-sm font-medium">No tools available yet</p>
					<p class="text-muted-foreground mt-1 text-xs">
						Ask an admin to publish a Grasshopper definition.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</PageContent>
