<script lang="ts">
	import { ArrowRight, Server, Star } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selvajs/platform';
	import { huesFor, monogram, formatUpdated } from './cardStyles';
	import { statusRing, statusDot } from '../../../routes/projects/_components/statusStyles';

	interface Props {
		record: DefinitionRecord;
		/** Click handler — caller decides what "open" means (run / drawer / etc.). */
		onOpen: (record: DefinitionRecord) => void;
		/** Optional project chip; pass when the surrounding view shows multiple projects. */
		projectName?: string;
		/** Visibility of the parent project. Shown as muted text alongside projectName. */
		projectVisibility?: 'public' | 'org' | 'private' | 'platform';

		// ---- Author surface (projects) ----
		/** When true, renders the status badge top-left and "updated X ago" in the footer. */
		showStatus?: boolean;
		/** Compute server this definition solves on. Shown in the footer when provided. */
		serverName?: string;

		// ---- Consumer surface (library) ----
		/** Spinner overlay while the runner navigates. */
		loading?: boolean;
		/** When provided, renders the star button top-right and reflects star state. */
		starred?: boolean;
		starBusy?: boolean;
		onToggleStar?: (guid: string) => void;
	}

	let {
		record,
		onOpen,
		projectName,
		projectVisibility,
		showStatus = false,
		serverName,
		loading = false,
		starred = false,
		starBusy = false,
		onToggleStar
	}: Props = $props();

	const hues = $derived(huesFor(record.guid));

	function activate() {
		if (loading) return;
		onOpen(record);
	}
	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			activate();
		}
	}
</script>

<div
	role="button"
	tabindex={loading ? -1 : 0}
	aria-disabled={loading}
	onclick={activate}
	onkeydown={handleKey}
	class="group border-border bg-card focus-visible:ring-ring flex flex-col overflow-hidden rounded-xl border text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_10px_30px_-16px_rgba(0,0,0,0.18)] focus:outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
>
	<div class="border-border relative aspect-4/3 overflow-hidden border-b">
		{#if record.coverImage}
			<img
				src={record.coverImage}
				alt={record.displayName}
				class="absolute inset-0 h-full w-full object-cover"
			/>
		{:else}
			<div
				class="tool-cover-fallback absolute inset-0 flex items-center justify-center"
				style:--tool-h1={hues.h1}
				style:--tool-h2={hues.h2}
			>
				<span class="text-foreground/40 text-4xl font-semibold">
					{monogram(record.displayName)}
				</span>
			</div>
		{/if}

		{#if showStatus}
			<div class="absolute top-2.5 left-2.5">
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-wide {statusRing(
						record.status
					)}"
				>
					<span class="h-1.5 w-1.5 rounded-full {statusDot(record.status)}"></span>
					{record.status}
				</span>
			</div>
		{/if}

		{#if onToggleStar}
			<button
				type="button"
				title={starred ? 'Unstar' : 'Star'}
				aria-label={starred ? 'Unstar definition' : 'Star definition'}
				aria-pressed={starred}
				disabled={starBusy}
				onclick={(e) => {
					e.stopPropagation();
					e.preventDefault();
					onToggleStar?.(record.guid);
				}}
				class={`absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-all disabled:opacity-60 ${
					starred
						? 'bg-amber-400/90 text-white'
						: 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/55'
				}`}
			>
				<Star class="h-3.5 w-3.5 {starred ? 'fill-current' : ''}" />
			</button>
		{/if}

		{#if loading}
			<div class="absolute inset-0 flex items-center justify-center bg-black/25">
				<div
					class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
				></div>
			</div>
		{/if}
	</div>

	<div class="flex flex-1 flex-col p-3.5">
		{#if projectName}
			<p class="text-muted-foreground mb-1 truncate font-mono text-[10.5px]">
				{projectName}{#if projectVisibility}&nbsp;·&nbsp;{projectVisibility}{/if}
			</p>
		{/if}
		<p class="truncate text-[14px] font-semibold">{record.displayName}</p>
		{#if record.description}
			<p class="text-muted-foreground mt-1 line-clamp-2 text-[12.5px] leading-relaxed">
				{record.description}
			</p>
		{/if}

		{#if record.tags?.length}
			<div class="mt-2.5 flex flex-wrap gap-1">
				{#each record.tags.slice(0, 3) as tag (tag)}
					<span class="bg-muted text-muted-foreground rounded px-1.5 py-px font-mono text-[10.5px]"
						>#{tag}</span
					>
				{/each}
			</div>
		{/if}

		<div class="mt-auto">
			{#if showStatus && serverName}
				<div
					class="text-muted-foreground mt-2.5 flex items-center gap-1.5 font-mono text-[11px]"
					title="Solves on {serverName}"
				>
					<Server class="h-3 w-3 shrink-0 opacity-70" />
					<span class="truncate">{serverName}</span>
				</div>
			{/if}
			<hr class="border-border my-3" />
			<div class="text-muted-foreground flex items-center justify-between text-[11.5px]">
				<span class="font-mono">
					{#if showStatus}
						{formatUpdated(record.updatedAt)} · {record.solveCount.toLocaleString()} runs
					{:else}
						{record.solveCount > 0 ? `${record.solveCount.toLocaleString()} runs` : 'No runs yet'}
					{/if}
				</span>
				{#if onToggleStar}
					<span
						class="text-foreground flex items-center gap-1 font-medium opacity-0 transition-opacity group-hover:opacity-100"
					>
						Open <ArrowRight class="h-3 w-3" />
					</span>
				{/if}
			</div>
		</div>
	</div>
</div>
