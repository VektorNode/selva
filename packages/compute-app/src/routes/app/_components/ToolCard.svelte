<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selvajs/platform';
	import StarButton from './StarButton.svelte';
	import { gradientFor, monogram } from './toolStyles';

	interface Props {
		record: DefinitionRecord;
		starred: boolean;
		loading: boolean;
		starBusy: boolean;
		projectName?: string;
		onOpen: (guid: string) => void;
		onToggleStar: (guid: string) => void;
	}

	let { record, starred, loading, starBusy, projectName, onOpen, onToggleStar }: Props = $props();
</script>

<button
	type="button"
	onclick={() => onOpen(record.guid)}
	disabled={loading}
	class="group border-border bg-card flex flex-col overflow-hidden rounded-xl border text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_10px_30px_-16px_rgba(0,0,0,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
>
	<div class="border-border relative aspect-16/10 overflow-hidden border-b">
		{#if record.coverImage}
			<img
				src={record.coverImage}
				alt={record.displayName}
				class="absolute inset-0 h-full w-full object-cover"
			/>
		{:else}
			<div
				class="absolute inset-0 flex items-center justify-center"
				style:background={gradientFor(record.guid)}
			>
				<span class="text-muted-foreground/70 text-4xl font-semibold">
					{monogram(record.displayName)}
				</span>
			</div>
		{/if}

		<StarButton
			{starred}
			busy={starBusy}
			variant="overlay"
			onToggle={() => onToggleStar(record.guid)}
		/>

		{#if projectName}
			<div class="absolute top-2.5 left-2.5">
				<span
					class="rounded-full bg-background/85 px-2 py-0.5 font-mono text-[10px] text-foreground backdrop-blur-sm"
				>
					{projectName}
				</span>
			</div>
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
		<p class="truncate text-[14.5px] font-semibold">{record.displayName}</p>
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
			<hr class="border-border my-3" />
			<div class="text-muted-foreground flex items-center justify-between text-[11.5px]">
				<span class="font-mono">
					{record.runCount > 0 ? `${record.runCount.toLocaleString()} runs` : 'No runs yet'}
				</span>
				<span
					class="text-foreground flex items-center gap-1 font-medium opacity-0 transition-opacity group-hover:opacity-100"
				>
					Open <ArrowRight class="h-3 w-3" />
				</span>
			</div>
		</div>
	</div>
</button>
