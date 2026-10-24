<script lang="ts">
	import { Button } from '$lib/components/primitives/button';
	import type { GeometryPickResult } from '$lib/contexts/hostContext.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import type { ViewerMessages } from '$lib/i18n/messages';

	interface Props {
		inputId: string;
		/** The kinds of object the input takes; one kind names the button after it. */
		kinds?: readonly string[];
		/** 1 picks a single object. */
		atMost?: number;
		/** What the host reports the param holds, such as "2 curves"; absent until something is picked. */
		summary?: string;
		onPick: () => Promise<GeometryPickResult>;
		onClear: () => void;
		/** Shown when the pick fails; the host's own message. */
		onError?: (message: string) => void;
		disabled?: boolean;
	}

	let {
		inputId,
		kinds,
		atMost,
		summary,
		onPick,
		onClear,
		onError,
		disabled = false
	}: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	const KIND_KEYS: Record<string, string> = {
		point: 'Point',
		pointCloud: 'PointCloud',
		curve: 'Curve',
		line: 'Line',
		plane: 'Plane',
		surface: 'Surface',
		polysurface: 'Polysurface',
		extrusion: 'Extrusion',
		mesh: 'Mesh',
		subd: 'Subd',
		block: 'Block'
	};

	const pickLabel = $derived.by(() => {
		const kind = kinds?.length === 1 ? KIND_KEYS[kinds[0]] : undefined;
		if (!kind) return t.geometryPick;
		const key = `geometryPick${kind}${atMost === 1 ? 'One' : 'Other'}` as keyof ViewerMessages;
		return t[key];
	});

	// Rhino's command line prompts during the pick; the page only keeps the button from being
	// pressed twice.
	let picking = $state(false);
	// The last pick or clear on this page wins over what the host reported when the page loaded.
	let local = $state<string | null | undefined>(undefined);
	const shown = $derived(local !== undefined ? local : (summary ?? null));

	async function pick() {
		picking = true;
		try {
			const result = await onPick();
			if (result.outcome === 'picked') local = result.summary;
			else if (result.outcome === 'failed') onError?.(result.error);
		} finally {
			picking = false;
		}
	}

	function clear() {
		local = null;
		onClear();
	}
</script>

<div class="gap-2 min-w-0 flex flex-wrap items-center">
	<Button id={inputId} variant="outline" size="sm" onclick={pick} disabled={disabled || picking}>
		{shown ? t.geometryPickAgain : pickLabel}
	</Button>
	{#if shown}
		<span class="text-sm min-w-0 truncate text-foreground">{shown}</span>
		<Button variant="ghost" size="sm" onclick={clear} disabled={disabled || picking}>
			{t.geometryClear}
		</Button>
	{/if}
</div>
