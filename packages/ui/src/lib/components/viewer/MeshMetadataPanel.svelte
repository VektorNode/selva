<script lang="ts">
	import { X } from '@lucide/svelte';
	import { Button } from '../primitives/button/index.js';
	import { getLocaleContext } from '#lib/i18n/localeContext.svelte.js';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		metadata: Record<string, any>;
		meshName: string | null;
		onClose: () => void;
		class?: string;
	}

	const EXCLUDED_KEYS = new Set(['name', 'layer', 'id']);

	let { metadata, meshName, onClose, class: className = '' }: Props = $props();

	const filteredMetadata = $derived.by(() => {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(metadata)) {
			if (EXCLUDED_KEYS.has(key)) continue;
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
	});
</script>

<!-- Not a modal: a modal locks the page, and on touch the tap that should dismiss it can race the
     dialog's own dismiss handler, leaving the viewer frozen. A card lets the canvas keep orbiting. -->
<section
	aria-label={meshName ?? t.objectFallbackName}
	class="min-h-0 shadow-lg backdrop-blur-sm flex flex-col overflow-hidden rounded-lg border bg-background/95 {className}"
>
	<header class="gap-2 py-1 pr-1 pl-4 flex items-center border-b">
		<h2 class="text-sm font-semibold min-w-0 flex-1 truncate">
			{meshName ?? t.objectFallbackName}
		</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			class="pointer-coarse:size-10 shrink-0"
			aria-label={t.close}
			title={t.close}
			onclick={onClose}
		>
			<X />
		</Button>
	</header>

	<div class="min-h-0 overflow-y-auto overscroll-contain">
		{#if Object.keys(filteredMetadata).length === 0}
			<p class="px-4 py-3 text-xs text-muted-foreground">{t.noMetadata}</p>
		{:else}
			<table class="text-xs w-full border-collapse">
				<tbody>
					{#each Object.entries(filteredMetadata) as [key, value] (key)}
						<tr class="border-b border-border/60 last:border-b-0">
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
									<span class={value ? 'text-success' : 'text-muted-foreground'}
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
</section>
