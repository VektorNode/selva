<script lang="ts">
	import * as Dialog from '../primitives/dialog/index.js';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		open: boolean;
		metadata: Record<string, any> | null;
		meshName: string | null;
		onOpenChange: (open: boolean) => void;
		isFullscreen?: boolean;
	}

	const EXCLUDED_KEYS = new Set(['name', 'layer', 'id']);

	let {
		open = $bindable(),
		metadata,
		meshName,
		onOpenChange,
		isFullscreen = false
	}: Props = $props();

	$effect(() => {
		document.body.toggleAttribute('data-viewer-fullscreen', isFullscreen);
	});

	const getFilteredMetadata = () => {
		if (!metadata) return {};
		const entries = Object.entries(metadata).filter(([key]) => !EXCLUDED_KEYS.has(key));
		const result: Record<string, unknown> = {};
		for (const [key, value] of entries) {
			if (
				key === 'metadata' &&
				typeof value === 'object' &&
				value !== null &&
				!Array.isArray(value)
			) {
				Object.assign(result, value);
			} else {
				result[key] = value;
			}
		}
		return result;
	};
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content class="min-w-60 max-w-xs p-0 gap-0 w-auto overflow-hidden">
		{#if meshName}
			<div class="px-4 pt-3 pb-2 border-b">
				<Dialog.Title class="text-sm font-semibold">{meshName}</Dialog.Title>
			</div>
		{:else}
			<Dialog.Title class="sr-only">{t.objectFallbackName}</Dialog.Title>
		{/if}

		<div class="max-h-80 overflow-y-auto">
			{#if !metadata || Object.keys(getFilteredMetadata()).length === 0}
				<p class="px-4 py-3 text-xs text-muted-foreground">{t.noMetadata}</p>
			{:else}
				<table class="text-xs w-full border-collapse">
					<tbody>
						{#each Object.entries(getFilteredMetadata()) as [key, value] (key)}
							<tr class="border-b border-border/60 transition-colors hover:bg-muted/40">
								<th
									scope="row"
									class="px-4 py-2 font-normal text-left align-top whitespace-nowrap text-muted-foreground"
									>{key}</th
								>
								<td class="px-4 py-2 text-right align-top text-foreground">
									{#if typeof value === 'object' && value !== null}
										{#if Array.isArray(value)}
											<div class="space-y-1 text-left">
												{#each value as item, index (index)}
													{#if typeof item === 'object'}
														<div class="space-y-0.5">
															{#each Object.entries(item) as [k, v] (k)}
																<div class="gap-2 flex">
																	<span class="shrink-0 text-muted-foreground">{k}:</span>
																	<span>{v}</span>
																</div>
															{/each}
														</div>
													{:else}
														<div>{item}</div>
													{/if}
												{/each}
											</div>
										{:else}
											<div class="space-y-0.5 text-left">
												{#each Object.entries(value) as [k, v] (k)}
													<div class="gap-2 flex">
														<span class="shrink-0 text-muted-foreground">{k}:</span>
														<span>{v}</span>
													</div>
												{/each}
											</div>
										{/if}
									{:else if typeof value === 'number'}
										<span class="font-mono">{value}</span>
									{:else if typeof value === 'boolean'}
										<span class={value ? 'text-green-500' : 'text-muted-foreground'}
											>{value ? 'true' : 'false'}</span
										>
									{:else}
										<span class="break-all">{value}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global([data-viewer-fullscreen] [data-slot='dialog-content']),
	:global([data-viewer-fullscreen] [data-slot='dialog-overlay']) {
		z-index: 10001;
	}
</style>
