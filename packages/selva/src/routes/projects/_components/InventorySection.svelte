<script lang="ts">
	import { inventoryWarningText, type InventoryWarning } from '@selvajs/schemas';
	import { Button } from '@selvajs/ui';
	import { TriangleAlert, Plus, Minus, PenLine, Code } from '@lucide/svelte';
	import type { InventoryReport } from './inventory.js';
	import ScriptDiff from './ScriptDiff.svelte';

	interface Props {
		report: InventoryReport;
		/** Number of the version compared with, for wording. */
		baseNumber?: number;
		/** Set where the version is stored, so script code can be read from it. */
		code?: { definitionGuid: string; versionId: string; against?: string };
		/** Shown when the base has no inventory yet: reads it from the stored file. */
		onReadBase?: () => void;
		readingBase?: boolean;
	}

	let { report, baseNumber, code, onReadBase, readingBase = false }: Props = $props();

	let openScript = $state<string | null>(null);

	const tone = (w: InventoryWarning) =>
		w.kind === 'missingPlugin' || w.kind === 'unloaded'
			? 'text-destructive'
			: w.kind === 'pluginVersion'
				? 'text-muted-foreground'
				: 'text-warning';
	const ICON = { added: Plus, removed: Minus, changed: PenLine };
	const counts = (list: { name: string; count: number }[]) =>
		list.map((c) => (c.count > 1 ? `${c.count} ${c.name}` : c.name)).join(', ');
	const shown = (text: string | null) =>
		text === null ? 'hidden: looks like a secret' : text || '(empty)';
</script>

<div class="space-y-3">
	{#if report.warnings.length}
		<ul class="space-y-1">
			{#each report.warnings as warning, i (i)}
				<li class="flex items-start gap-2 text-sm">
					<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 {tone(warning)}" />
					<span>{inventoryWarningText(warning)}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<section class="space-y-1.5">
		<h4 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
			Inside the definition
		</h4>
		{#if report.missing === 'base'}
			<div class="flex flex-wrap items-center gap-2">
				<p class="text-muted-foreground text-sm">
					{baseNumber ? `v${baseNumber}` : 'The version compared with'} was uploaded before Selva read
					what is inside a file.
				</p>
				{#if onReadBase}
					<Button size="sm" variant="outline" onclick={onReadBase} disabled={readingBase}>
						{readingBase ? 'Reading…' : 'Read it now'}
					</Button>
				{/if}
			</div>
		{:else if !report.diff}
			<p class="text-muted-foreground text-sm">Nothing to compare with.</p>
		{:else if report.diff.identical}
			<p class="text-muted-foreground text-sm">
				Same plugins, components, values, scripts and wiring.
			</p>
		{:else}
			{@const d = report.diff}
			<ul class="bg-muted space-y-1.5 rounded-md p-2 text-sm">
				{#each d.plugins as p (p.plugin)}
					{@const Icon = ICON[p.change]}
					<li class="flex items-start gap-2">
						<Icon class="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							Plugin <strong>{p.plugin}</strong>
							{#if p.change === 'changed'}
								<span class="font-mono text-xs">{p.before} → {p.after}</span>
							{:else if p.change === 'added'}
								added <span class="font-mono text-xs">{p.after}</span>
							{:else}
								no longer used
							{/if}
						</span>
					</li>
				{/each}
				{#if d.components.added.length}
					<li class="flex items-start gap-2">
						<Plus class="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>Components added: {counts(d.components.added)}</span>
					</li>
				{/if}
				{#if d.components.removed.length}
					<li class="flex items-start gap-2">
						<Minus class="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>Components removed: {counts(d.components.removed)}</span>
					</li>
				{/if}
				{#each d.scripts as s (s.id)}
					{@const Icon = ICON[s.change]}
					<li class="space-y-1.5">
						<div class="flex flex-wrap items-center gap-2">
							<Icon class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
							<span>
								Script <strong>{s.label}</strong>
								<span class="text-muted-foreground text-xs">{s.language}</span>
								{#if s.change === 'changed'}
									<span class="font-mono text-xs">
										<span class="text-success">+{s.linesAdded}</span>
										<span class="text-destructive">−{s.linesRemoved}</span> lines
									</span>
								{:else}
									{s.change}
								{/if}
							</span>
							{#if code}
								<Button
									size="xs"
									variant="ghost"
									aria-expanded={openScript === s.id}
									onclick={() => (openScript = openScript === s.id ? null : s.id)}
								>
									<Code class="mr-1 h-3 w-3" />
									{openScript === s.id ? 'Hide code' : 'Show code changes'}
								</Button>
							{/if}
						</div>
						{#if code && openScript === s.id}
							<ScriptDiff {...code} scriptId={s.id} />
						{/if}
					</li>
				{/each}
				{#each d.values as v (v.id)}
					<li class="flex items-start gap-2">
						<PenLine class="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div class="min-w-0">
							<span class="font-medium">{v.label}</span>
							<span class="text-muted-foreground text-xs">{v.kind}</span>
							<p class="text-muted-foreground font-mono text-xs break-words">
								{shown(v.before)} → {shown(v.after)}
								{#if v.range}· range {v.range.before} → {v.range.after}{/if}
							</p>
						</div>
					</li>
				{/each}
				{#if d.wires.changed}
					<li class="text-muted-foreground flex items-start gap-2">
						<PenLine class="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							Wiring changed{d.wires.before !== d.wires.after
								? `: ${d.wires.before} → ${d.wires.after} wires`
								: ''}
						</span>
					</li>
				{/if}
			</ul>
		{/if}
	</section>
</div>
