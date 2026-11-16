<script lang="ts">
	import type { SchemaChange, SchemaChangeImpact, SchemaDiff } from '@selvajs/schemas';
	import { Plus, Minus, PenLine } from '@lucide/svelte';

	interface Props {
		diff: SchemaDiff;
	}

	let { diff }: Props = $props();

	const SECTIONS: { impact: SchemaChangeImpact; title: string; hint: string }[] = [
		{
			impact: 'breaking',
			title: 'Breaking',
			hint: 'Saved values, share links or API callers that use these may stop working.'
		},
		{ impact: 'notable', title: 'Changes', hint: 'Behaves differently; old values still apply.' },
		{ impact: 'cosmetic', title: 'Cosmetic', hint: 'Labels, help text and layout only.' }
	];

	const TONE: Record<SchemaChangeImpact, string> = {
		breaking: 'text-destructive',
		notable: 'text-warning',
		cosmetic: 'text-muted-foreground'
	};

	const ICON = { added: Plus, removed: Minus, changed: PenLine };

	function subject(c: SchemaChange): string {
		if (c.kind === 'settings') return c.label;
		return c.change === 'changed'
			? c.label
			: `${c.change === 'added' ? 'New' : 'Removed'} ${c.kind}: ${c.label}`;
	}
</script>

{#if diff.identical}
	<p class="text-muted-foreground text-sm">
		No changes to inputs, outputs or settings. Only the Grasshopper logic behind them can differ.
	</p>
{:else}
	<div class="space-y-3">
		{#each SECTIONS as section (section.impact)}
			{@const items = diff.changes.filter((c) => c.impact === section.impact)}
			{#if items.length}
				<section class="space-y-1.5">
					<div class="flex items-baseline gap-2">
						<h4 class="text-xs font-semibold tracking-wide uppercase {TONE[section.impact]}">
							{section.title} · {items.length}
						</h4>
						<p class="text-muted-foreground truncate text-xs">{section.hint}</p>
					</div>
					<ul class="bg-muted space-y-1 rounded-md p-2">
						{#each items as change (change.kind + change.id)}
							{@const Icon = ICON[change.change]}
							<li class="flex items-start gap-2 text-sm">
								<Icon class="mt-0.5 h-3.5 w-3.5 shrink-0 {TONE[change.impact]}" />
								<div class="min-w-0">
									<span class="font-medium">{subject(change)}</span>
									{#if change.kind !== 'settings' && change.change === 'changed'}
										<span class="text-muted-foreground text-xs">{change.kind}</span>
									{/if}
									{#if change.details.length}
										<p class="text-muted-foreground font-mono text-xs break-words">
											{change.details.join(' · ')}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	</div>
{/if}
