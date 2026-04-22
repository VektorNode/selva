<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { ArrowRight } from '@lucide/svelte';
	import { Search } from 'selva-shared';
	import type { DefinitionRecord } from '@selva/platform';

	let { data }: { data: PageData } = $props();

	let searchQuery = $state('');
	let activeProjectId = $state<string | null>(null);
	let loadingGuid = $state<string | null>(null);

	const projectList = $derived(Object.values(data.projects));

	const filterRecords = (list: DefinitionRecord[]) => {
		let out = list;
		if (activeProjectId) out = out.filter((r) => r.projectId === activeProjectId);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			out = out.filter(
				(r) =>
					r.meta.displayName?.toLowerCase().includes(q) ||
					r.meta.description?.toLowerCase().includes(q) ||
					r.meta.category?.toLowerCase().includes(q) ||
					r.meta.tags?.some((t) => t.toLowerCase().includes(q))
			);
		}
		return out;
	};

	const filteredStarred = $derived(filterRecords(data.starredRecords));
	const filteredAll = $derived(filterRecords(data.records));
	const totalVisible = $derived(filteredStarred.length + filteredAll.length);

	function open(guid: string) {
		loadingGuid = guid;
		goto(`/app/${guid}`).catch(() => {
			loadingGuid = null;
		});
	}

	function formatRelative(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const m = Math.floor(diff / 60000);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	function categoryLabel(r: DefinitionRecord, project?: { id: string; name: string }) {
		return (r.meta.category ?? project?.name ?? '').toUpperCase();
	}
</script>

<div class="px-6 pb-20">
	<!-- Hero search -->
	<div class="mx-auto max-w-2xl pt-14 pb-12 text-center">
		<Search
			bind:value={searchQuery}
			placeholder="Search tools…"
			autofocus
			clearable
			containerClass="mx-auto mt-8 max-w-lg"
			class="h-12 rounded-xl text-[14px] shadow-sm"
		/>

		<!-- Project filter pills -->
		{#if projectList.length > 1}
			<div class="mt-4 flex flex-wrap justify-center gap-1.5">
				<button
					onclick={() => (activeProjectId = null)}
					class="rounded-full px-3 py-1 font-mono text-[11px] tracking-wide uppercase transition-colors {activeProjectId ===
					null
						? 'bg-foreground text-background'
						: 'bg-muted text-muted-foreground hover:text-foreground'}">All</button
				>
				{#each projectList as p (p.id)}
					<button
						onclick={() => (activeProjectId = activeProjectId === p.id ? null : p.id)}
						class="rounded-full px-3 py-1 font-mono text-[11px] tracking-wide uppercase transition-colors {activeProjectId ===
						p.id
							? 'bg-foreground text-background'
							: 'bg-muted text-muted-foreground hover:text-foreground'}">{p.name}</button
					>
				{/each}
			</div>
		{/if}
	</div>

	<div class="mx-auto max-w-5xl space-y-14">
		<!-- Recent runs -->
		{#if data.recentRuns.length > 0 && !searchQuery && !activeProjectId}
			<section>
				<div class="mb-4 flex items-baseline justify-between">
					<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase"
						>Recent runs</span
					>
					<span class="text-muted-foreground text-[12px]">Resume where you left off</span>
				</div>
				<div class="border-border bg-card overflow-hidden rounded-xl border">
					{#each data.recentRuns.slice(0, 5) as run, i (run.runId)}
						<button
							onclick={() => open(run.definitionId)}
							disabled={loadingGuid === run.definitionId}
							class="hover:bg-muted/50 group grid w-full items-center gap-4 px-5 py-3.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60
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

		<!-- Starred / Pinned -->
		{#if filteredStarred.length > 0}
			<section>
				<div class="mb-4 flex items-baseline justify-between">
					<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase"
						>Pinned for you</span
					>
					<span class="text-muted-foreground text-[12px]">{filteredStarred.length} tools</span>
				</div>
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredStarred as record (record.guid)}
						{@const project = data.projects[record.projectId]}
						<button
							onclick={() => open(record.guid)}
							disabled={loadingGuid === record.guid}
							class="group border-border bg-card flex flex-col overflow-hidden rounded-xl border text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_10px_30px_-16px_rgba(0,0,0,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
						>
							<div class="border-border bg-muted relative aspect-[16/10] overflow-hidden border-b">
								{#if record.meta.coverImage}
									<img
										src={record.meta.coverImage}
										alt={record.meta.displayName}
										class="absolute inset-0 h-full w-full object-cover"
									/>
								{/if}
								<div class="absolute top-2.5 left-2.5">
									<span
										class="border-border bg-card text-muted-foreground rounded border px-1.5 py-px font-mono text-[10px]"
										>★ PINNED</span
									>
								</div>
								{#if loadingGuid === record.guid}
									<div class="absolute inset-0 flex items-center justify-center bg-black/25">
										<div
											class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
										></div>
									</div>
								{/if}
							</div>
							<div class="flex flex-1 flex-col p-3.5">
								<div class="flex items-start justify-between gap-2">
									<p class="truncate text-[14.5px] font-semibold">{record.meta.displayName}</p>
									{#if categoryLabel(record, project)}
										<span class="text-muted-foreground mt-0.5 shrink-0 font-mono text-[10.5px]"
											>{categoryLabel(record, project)}</span
										>
									{/if}
								</div>
								{#if record.meta.description}
									<p class="text-muted-foreground mt-1 line-clamp-2 text-[12.5px] leading-relaxed">
										{record.meta.description}
									</p>
								{/if}
								<div class="mt-auto">
									<hr class="border-border my-3" />
									<div
										class="text-muted-foreground flex items-center justify-between text-[11.5px]"
									>
										<span class="font-mono"
											>{record.runCount > 0
												? `${record.runCount.toLocaleString()} runs`
												: 'No runs yet'}</span
										>
										<span
											class="text-foreground flex items-center gap-1 font-medium opacity-0 transition-opacity group-hover:opacity-100"
											>Open <ArrowRight class="h-3 w-3" /></span
										>
									</div>
								</div>
							</div>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<!-- All tools -->
		{#if filteredAll.length > 0}
			<section>
				<div class="mb-4 flex items-baseline justify-between">
					<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
						{filteredStarred.length > 0 ? 'All tools' : searchQuery ? 'Results' : 'All tools'}
					</span>
					<span class="text-muted-foreground text-[12px]">{filteredAll.length} available</span>
				</div>
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredAll as record (record.guid)}
						{@const project = data.projects[record.projectId]}
						<button
							onclick={() => open(record.guid)}
							disabled={loadingGuid === record.guid}
							class="group border-border bg-card flex flex-col overflow-hidden rounded-xl border text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_10px_30px_-16px_rgba(0,0,0,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
						>
							<div class="border-border bg-muted relative aspect-[16/10] overflow-hidden border-b">
								{#if record.meta.coverImage}
									<img
										src={record.meta.coverImage}
										alt={record.meta.displayName}
										class="absolute inset-0 h-full w-full object-cover"
									/>
								{/if}
								{#if loadingGuid === record.guid}
									<div class="absolute inset-0 flex items-center justify-center bg-black/25">
										<div
											class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
										></div>
									</div>
								{/if}
							</div>
							<div class="flex flex-1 flex-col p-3.5">
								<div class="flex items-start justify-between gap-2">
									<p class="truncate text-[14.5px] font-semibold">{record.meta.displayName}</p>
									{#if categoryLabel(record, project)}
										<span class="text-muted-foreground mt-0.5 shrink-0 font-mono text-[10.5px]"
											>{categoryLabel(record, project)}</span
										>
									{/if}
								</div>
								{#if record.meta.description}
									<p class="text-muted-foreground mt-1 line-clamp-2 text-[12.5px] leading-relaxed">
										{record.meta.description}
									</p>
								{/if}
								<div class="mt-auto">
									<hr class="border-border my-3" />
									<div
										class="text-muted-foreground flex items-center justify-between text-[11.5px]"
									>
										<span class="font-mono"
											>{record.runCount > 0
												? `${record.runCount.toLocaleString()} runs`
												: 'No runs yet'}</span
										>
										<span
											class="text-foreground flex items-center gap-1 font-medium opacity-0 transition-opacity group-hover:opacity-100"
											>Open <ArrowRight class="h-3 w-3" /></span
										>
									</div>
								</div>
							</div>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Empty -->
		{#if totalVisible === 0}
			<div class="flex flex-col items-center justify-center py-24 text-center">
				{#if searchQuery}
					<p class="text-sm font-medium">No tools match "{searchQuery}"</p>
					<p class="text-muted-foreground mt-1 text-xs">Try a different search term.</p>
				{:else}
					<p class="text-sm font-medium">No tools available yet</p>
					<p class="text-muted-foreground mt-1 text-xs">
						Ask an admin to publish a Grasshopper definition.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
