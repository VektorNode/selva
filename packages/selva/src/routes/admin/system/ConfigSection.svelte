<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import type {
		ConfigChange,
		ConfigReport,
		KeyRotation,
		ReportRow
	} from '@selvajs/platform/config';

	let {
		report,
		changes,
		atRestOnPreviousKey,
		rotation
	}: {
		report: ConfigReport;
		changes: ConfigChange[];
		atRestOnPreviousKey: number | null;
		rotation: KeyRotation[];
	} = $props();

	const rotating = $derived(rotation.filter((r) => r.state !== 'none'));

	const summaryRows = $derived(report.rows.filter((r) => r.summary));
	const otherRows = $derived(report.rows.filter((r) => !r.summary));
	const problemCount = $derived(report.problems.length + report.unknown.length);

	function sourceLabel(row: ReportRow): string {
		if (row.source === 'default') return 'default';
		if (row.source === 'unset') return 'not set';
		if (row.source === 'alias') return `from ${row.alias}`;
		return '.env';
	}
</script>

{#snippet configRow(row: ReportRow)}
	<div class="flex items-start justify-between gap-4 px-4 py-2.5">
		<div class="min-w-0 flex-1">
			<code class="text-foreground font-mono text-xs">{row.key}</code>
			<p class="text-muted-foreground mt-0.5 text-xs">{row.description}</p>
			{#if row.problem}
				<p class="text-destructive mt-0.5 text-xs">Value {row.problem}.</p>
			{/if}
		</div>
		<div class="flex shrink-0 flex-col items-end gap-1">
			<span
				class="border-border text-foreground text-2xs max-w-64 truncate rounded-full border px-2 py-0.5 font-mono"
				title={row.display}
			>
				{row.display || '—'}
			</span>
			<span class="text-muted-foreground text-2xs">{sourceLabel(row)}</span>
		</div>
	</div>
{/snippet}

<div class="space-y-3">
	<div class="divide-y rounded-lg border">
		{#each summaryRows as row (row.key)}
			{@render configRow(row)}
		{/each}
	</div>

	{#each rotating as r (r.key)}
		<p
			class={`rounded-lg border px-4 py-3 text-xs ${
				r.state === 'active' ? 'text-muted-foreground' : 'border-warning/40 bg-warning/10'
			}`}
		>
			<code class="font-mono">{r.key}_PREVIOUS</code>
			{#if r.state === 'active'}
				is accepted for {r.daysLeft} more {r.daysLeft === 1 ? 'day' : 'days'}, until
				{r.expires?.slice(0, 10)}. After that it is refused on its own.
			{:else if r.state === 'expired'}
				passed its deadline ({r.expires?.slice(0, 10)}) and is no longer accepted. Remove it with
				<code class="font-mono"
					>selva keys rotate {r.key === 'SELVA_HMAC_KEY' ? 'hmac' : 'at-rest'} --finish</code
				>.
			{:else}
				has no deadline, so the old key is accepted for good. Remove it with
				<code class="font-mono"
					>selva keys rotate {r.key === 'SELVA_HMAC_KEY' ? 'hmac' : 'at-rest'} --finish</code
				>, or set <code class="font-mono">{r.key}_PREVIOUS_EXPIRES</code>.
			{/if}
		</p>
	{/each}

	{#if atRestOnPreviousKey !== null}
		<p class="text-muted-foreground rounded-lg border px-4 py-3 text-xs">
			{#if atRestOnPreviousKey > 0}
				{atRestOnPreviousKey} stored compute API {atRestOnPreviousKey === 1 ? 'key is' : 'keys are'} still
				sealed under <code class="font-mono">SELVA_AT_REST_KEY_PREVIOUS</code>. Restart the app to
				re-seal
				{atRestOnPreviousKey === 1 ? 'it' : 'them'}; do not run
				<code class="font-mono">selva keys rotate at-rest --finish</code> yet.
			{:else}
				Every stored compute API key is on the current key:
				<code class="font-mono">selva keys rotate at-rest --finish</code> is safe.
			{/if}
		</p>
	{/if}

	{#if problemCount > 0}
		<div class="border-warning/40 bg-warning/10 space-y-1 rounded-lg border px-4 py-3 text-xs">
			<p class="text-warning font-medium">
				{problemCount} configuration {problemCount === 1 ? 'problem' : 'problems'}
			</p>
			{#each report.problems as p (p.key)}
				<p>
					<code class="font-mono">{p.key}</code>
					{p.problem}{p.status === 'invalid' ? ': running on the default' : ''}.
				</p>
			{/each}
			{#each report.unknown as u (u.key)}
				<p>
					<code class="font-mono">{u.key}</code> is not a setting Selva reads{#if u.suggestion}: did
						you mean <code class="font-mono">{u.suggestion}</code>?{:else}.{/if}
				</p>
			{/each}
		</div>
	{/if}

	{#if changes.length > 0}
		<div class="space-y-1 rounded-lg border px-4 py-3 text-xs">
			<p class="font-medium">Changed since the last start</p>
			{#each changes as c (c.key)}
				<p class="text-muted-foreground">
					<code class="text-foreground font-mono">{c.key}</code>
					{#if c.change === 'added'}set{c.to !== undefined ? ` to ${c.to}` : ''}
					{:else if c.change === 'removed'}removed{c.from !== undefined ? ` (was ${c.from})` : ''}
					{:else if c.from !== undefined}{c.from} → {c.to}
					{:else}changed{/if}
				</p>
			{/each}
		</div>
	{/if}

	<details class="group rounded-lg border">
		<summary
			class="hover:bg-hover flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium select-none"
		>
			<ChevronRight class="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
			All settings
			<span class="text-muted-foreground ml-auto font-mono text-xs">{otherRows.length}</span>
		</summary>
		<div class="divide-y border-t">
			{#each otherRows as row (row.key)}
				{@render configRow(row)}
			{/each}
		</div>
	</details>
</div>
