<script lang="ts" module>
	import type { Severity } from './severity';

	export interface Issue {
		severity: Severity;
		message: string;
		/** A second, quieter line: expected vs actual, a path, a hint. */
		detail?: string;
		/** What raised it, such as the component's nickname. */
		source?: string;
		/** How many times the same message came in; shown as ×n above 1. */
		count?: number;
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';
	import SeverityIcon from './SeverityIcon.svelte';

	interface Props {
		issues: readonly Issue[];
		/** `boxed` draws a bordered, divided list; `plain` is for surfaces that already have a frame. */
		variant?: 'boxed' | 'plain';
		class?: string;
	}

	let { issues, variant = 'boxed', class: className }: Props = $props();
</script>

<ul
	class={cn(
		'text-sm',
		variant === 'boxed' ? 'divide-y rounded-lg border' : 'gap-2 flex flex-col',
		className
	)}
>
	{#each issues as issue, i (i)}
		<li class={cn('gap-2 flex items-start', variant === 'boxed' && 'px-3 py-2')}>
			<SeverityIcon severity={issue.severity} class="mt-0.5" />
			<div class="min-w-0 flex-1">
				<p class="wrap-anywhere">
					{issue.message}
					{#if issue.count && issue.count > 1}
						<span class="ml-1 text-xs text-muted-foreground tabular-nums">×{issue.count}</span>
					{/if}
				</p>
				{#if issue.source}
					<p class="text-xs text-muted-foreground">{issue.source}</p>
				{/if}
				{#if issue.detail}
					<p class="mt-0.5 text-xs wrap-anywhere text-muted-foreground">{issue.detail}</p>
				{/if}
			</div>
		</li>
	{/each}
</ul>
