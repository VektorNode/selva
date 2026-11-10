<script lang="ts">
	import type { DropdownWidgetConfig, SupportedTypes, UISchema } from '@selvajs/schemas';
	import type { RepeatSpec } from '#lib/schema/dynamic-value-list.js';
	import DropdownInput from './inputs/DropdownInput.svelte';

	interface Props {
		repeat: RepeatSpec;
		/** Display name of each member input, keyed by input id. */
		memberLabels: Record<string, string>;
		/** Each member's resolved picks, one per row in row order. */
		shown: Record<string, unknown>;
		rowOptions: Record<string, Record<string, string>[]>;
		onPick: (memberId: string, rowKey: string, pick: string) => void;
		disabled?: boolean;
		assets?: UISchema['assets'];
	}

	let {
		repeat,
		memberLabels,
		shown,
		rowOptions,
		onPick,
		disabled = false,
		assets
	}: Props = $props();

	// Rows keep Grasshopper's order; a section is drawn where its first row appears.
	const sections = $derived.by(() => {
		const out: { label: string; rows: { index: number; key: string; label: string }[] }[] = [];
		repeat.rows.forEach((row, index) => {
			const label = row.section ?? '';
			let section = out.find((s) => s.label === label);
			if (!section) out.push((section = { label, rows: [] }));
			section.rows.push({ index, key: row.key, label: row.label || row.key });
		});
		return out;
	});

	function rowValue(memberId: string, index: number): string | undefined {
		const picks = shown[memberId];
		return Array.isArray(picks) && typeof picks[index] === 'string' ? picks[index] : undefined;
	}

	function setRow(memberId: string, rowKey: string, value: SupportedTypes) {
		if (typeof value === 'string') onPick(memberId, rowKey, value);
	}

	const configFor = (memberId: string, index: number) =>
		({ options: rowOptions[memberId]?.[index] ?? {} }) as DropdownWidgetConfig;

	// One column per member, written out so Tailwind sees each class; past four they wrap.
	const COLUMNS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4'];
	const columns = $derived(COLUMNS[Math.min(repeat.members.length, 4)]);
</script>

<!-- The row's name sits above its controls: beside them, a side panel leaves each list too
     narrow to read its value. -->
<div class="gap-5 flex flex-col">
	{#each sections as section (section.label)}
		<section class="gap-3 flex flex-col" aria-label={section.label || undefined}>
			<div class="gap-1 flex flex-col">
				{#if section.label}
					<h3 class="text-sm font-medium text-foreground">{section.label}</h3>
				{/if}
				<div class="gap-x-2 grid {columns}">
					{#each repeat.members as member (member)}
						<span class="text-xs truncate text-muted-foreground"
							>{memberLabels[member] ?? member}</span
						>
					{/each}
				</div>
			</div>
			{#each section.rows as row (row.key)}
				<div class="gap-1.5 flex flex-col">
					<span class="text-sm truncate" title={row.label}>{row.label}</span>
					<div class="gap-2 grid items-center {columns}">
						{#each repeat.members as member (member)}
							<div role="group" aria-label="{row.label}: {memberLabels[member] ?? member}">
								<DropdownInput
									value={rowValue(member, row.index)}
									config={configFor(member, row.index)}
									onChange={(value) => setRow(member, row.key, value)}
									{disabled}
									{assets}
								/>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</section>
	{/each}
</div>
