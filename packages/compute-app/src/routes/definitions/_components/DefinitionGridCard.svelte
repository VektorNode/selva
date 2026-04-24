<script lang="ts">
	import { Separator } from 'selva-shared';
	import type { DefinitionRecord } from '../+page.server';
	import StatusBadge from './StatusBadge.svelte';
	import { formatUpdated } from './statusStyles';

	interface Props {
		record: DefinitionRecord;
		onOpen: (record: DefinitionRecord) => void;
	}

	let { record, onOpen }: Props = $props();
</script>

<button
	onclick={() => onOpen(record)}
	class="border-border bg-card cursor-pointer overflow-hidden rounded-xl border text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]"
>
	<div class="border-border bg-muted relative aspect-4/3 overflow-hidden border-b">
		{#if record.coverImage}
			<img
				src={record.coverImage}
				alt={record.displayName}
				class="absolute inset-0 h-full w-full object-cover"
			/>
		{/if}
		<div class="absolute top-2.5 left-2.5">
			<StatusBadge status={record.status} />
		</div>
	</div>
	<div class="p-3.5">
		<p class="truncate text-[13.5px] font-semibold">{record.displayName}</p>
		{#if record.description}
			<p class="text-muted-foreground mt-1 line-clamp-2 text-[12.5px] leading-relaxed">
				{record.description}
			</p>
		{/if}
		{#if record.tags?.length}
			<div class="mt-2.5 flex flex-wrap gap-1">
				{#each record.tags.slice(0, 3) as tag (tag)}
					<span
						class="bg-muted text-muted-foreground rounded px-1.5 py-px font-mono text-[10.5px]"
						>#{tag}</span
					>
				{/each}
			</div>
		{/if}
		<Separator class="my-3" />
		<div
			class="text-muted-foreground flex items-center justify-between font-mono text-[11.5px]"
		>
			<span>{formatUpdated(record.updatedAt)} ago</span>
			<span>{record.runCount.toLocaleString()} runs</span>
		</div>
	</div>
</button>
