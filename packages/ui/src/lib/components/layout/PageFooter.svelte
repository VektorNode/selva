<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CircleAlert, TriangleAlert, Info } from '@lucide/svelte';
	import type { SolveDiagnostic } from '@selvajs/solve/shared';
	import { useFooter } from '$lib/contexts/footerContext.svelte';
	import ComputeMessagesDialog from '../compute/ComputeMessagesDialog.svelte';
	import FooterItemRenderer from './FooterItemRenderer.svelte';

	interface Props {
		errors?: string[];
		warnings?: string[];
		/** Structured messages, including remarks. Preferred over the two arrays above. */
		diagnostics?: SolveDiagnostic[];
		copyrightName?: string;
		/** Fully overrides the copyright line. `{name}` and `{year}` are substituted. */
		footerText?: string;
		children?: Snippet;
	}

	let {
		errors = [],
		warnings = [],
		diagnostics,
		copyrightName = 'Selva',
		footerText,
		children
	}: Props = $props();

	let footerStore = (() => {
		try {
			return useFooter();
		} catch {
			return null;
		}
	})();

	const leftItems = $derived(
		footerStore
			? Array.from(footerStore.items.values())
					.filter((item) => item.position === 'left')
					.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			: []
	);
	const rightItems = $derived(
		footerStore
			? Array.from(footerStore.items.values())
					.filter((item) => item.position === 'right')
					.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			: []
	);

	let _currentYear = new Date().getFullYear();

	// Counts come from `diagnostics` when the host supplies it, so remarks are included and the
	// badge matches what the dialog lists.
	const errorCount = $derived(
		diagnostics ? diagnostics.filter((d) => d.level === 'error').length : errors.length
	);
	const warningCount = $derived(
		diagnostics ? diagnostics.filter((d) => d.level === 'warning').length : warnings.length
	);
	const remarkCount = $derived(
		diagnostics ? diagnostics.filter((d) => d.level === 'remark').length : 0
	);
	const totalCount = $derived(errorCount + warningCount + remarkCount);
	const hasMessages = $derived(totalCount > 0);

	const copyrightLine = $derived(
		footerText
			? footerText.replace('{name}', copyrightName).replace('{year}', String(_currentYear))
			: `by ${copyrightName} © ${_currentYear}`
	);
</script>

<footer
	class="px-4 gap-4 text-xs h-7 flex shrink-0 items-center justify-between border-t border-border bg-background text-muted-foreground select-none"
>
	<div class="gap-4 flex items-center">
		{#each leftItems as item (item.id)}
			<FooterItemRenderer {item} />
		{/each}

		{#if hasMessages}
			<ComputeMessagesDialog {errors} {warnings} {diagnostics}>
				{#snippet trigger()}
					<div
						class="gap-1.5 px-2 py-1 rounded flex cursor-pointer items-center transition-colors hover:bg-muted {errorCount >
						0
							? 'text-destructive hover:bg-destructive/10'
							: warningCount > 0
								? 'text-warning hover:bg-warning/10'
								: 'hover:bg-muted'}"
						title={`${totalCount} ${totalCount === 1 ? 'message' : 'messages'} from the last solve`}
					>
						{#if errorCount > 0}
							<CircleAlert class="h-3.5 w-3.5" />
							<span class="font-medium">{errorCount} Error{errorCount !== 1 ? 's' : ''}</span>
						{/if}

						{#if warningCount > 0}
							{#if errorCount > 0}
								<span class="text-border">•</span>
							{/if}
							<TriangleAlert class="h-3.5 w-3.5" />
							<span class="font-medium">{warningCount} Warning{warningCount !== 1 ? 's' : ''}</span>
						{/if}

						{#if errorCount === 0 && warningCount === 0}
							<Info class="h-3.5 w-3.5" />
							<span class="font-medium">{remarkCount} Note{remarkCount !== 1 ? 's' : ''}</span>
						{/if}
					</div>
				{/snippet}
			</ComputeMessagesDialog>
		{/if}

		{#if children}
			<div class="gap-4 flex items-center">
				{@render children()}
			</div>
		{/if}
	</div>

	<div class="gap-4 ml-auto flex items-center">
		{#each rightItems as item (item.id)}
			<FooterItemRenderer {item} />
		{/each}

		<p>{copyrightLine}</p>
	</div>
</footer>
