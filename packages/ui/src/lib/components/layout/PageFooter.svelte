<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CircleAlert, TriangleAlert } from '@lucide/svelte';
	import { useFooter } from '$lib/contexts/footerContext.svelte';
	import ComputeMessagesDialog from '../compute/ComputeMessagesDialog.svelte';
	import FooterItemRenderer from './FooterItemRenderer.svelte';

	interface Props {
		errors?: string[];
		warnings?: string[];
		copyrightName?: string;
		/** Fully overrides the copyright line. `{name}` and `{year}` are substituted. */
		footerText?: string;
		children?: Snippet;
	}

	let {
		errors = [],
		warnings = [],
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

	const hasMessages = $derived(errors.length > 0 || warnings.length > 0);
	const totalCount = $derived(errors.length + warnings.length);

	const copyrightLine = $derived(
		footerText
			? footerText.replace('{name}', copyrightName).replace('{year}', String(_currentYear))
			: `by ${copyrightName} © ${_currentYear}`
	);
</script>

<footer
	class="px-4 gap-4 text-xs h-7 flex shrink-0 items-center justify-between border-t border-border bg-background text-muted-foreground select-none"
>
	<!-- Left section: Status items + custom context items -->
	<div class="gap-4 flex items-center">
		<!-- Custom left items from context -->
		{#each leftItems as item (item.id)}
			<FooterItemRenderer {item} />
		{/each}

		{#if hasMessages}
			<ComputeMessagesDialog {errors} {warnings}>
				{#snippet trigger()}
					<div
						class="gap-1.5 px-2 py-1 rounded flex cursor-pointer items-center transition-colors hover:bg-muted {errors.length >
						0
							? 'text-destructive hover:bg-destructive/10'
							: 'text-warning hover:bg-warning/10'}"
						title={`${totalCount} ${totalCount === 1 ? 'issue' : 'issues'}`}
					>
						{#if errors.length > 0}
							<CircleAlert class="h-3.5 w-3.5" />
							<span class="font-medium">{errors.length} Error{errors.length !== 1 ? 's' : ''}</span>
						{/if}

						{#if warnings.length > 0}
							{#if errors.length > 0}
								<span class="text-border">•</span>
							{/if}
							<TriangleAlert class="h-3.5 w-3.5" />
							<span class="font-medium"
								>{warnings.length} Warning{warnings.length !== 1 ? 's' : ''}</span
							>
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

	<!-- Right section: Custom items + Copyright -->
	<div class="gap-4 ml-auto flex items-center">
		<!-- Custom right items from context -->
		{#each rightItems as item (item.id)}
			<FooterItemRenderer {item} />
		{/each}

		<p>{copyrightLine}</p>
	</div>
</footer>
