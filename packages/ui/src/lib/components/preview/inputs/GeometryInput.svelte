<script lang="ts">
	import { Button } from '$lib/components/primitives/button';
	import type { GeometryPickResult, PickKind } from '$lib/contexts/hostContext.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import type { ViewerMessages } from '$lib/i18n/messages';

	interface Props {
		inputId: string;
		/** The kinds of object the input takes; one kind names the button after it. */
		kinds?: readonly PickKind[];
		/** 1 picks a single object. */
		atMost?: number;
		/** What the host reports the param holds, such as "2 curves"; absent until something is picked. */
		summary?: string;
		/** Absent where this page may not pick, such as a browser tab beside the Rhino panel. */
		onPick?: () => Promise<GeometryPickResult>;
		onClear?: () => void;
		/** Subscribes to what the host holds after any page picks or clears; returns an unsubscribe. */
		watchSummary?: (listener: (summary: string | null) => void) => () => void;
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
		watchSummary,
		onError,
		disabled = false
	}: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	type PickLabels = readonly [one: keyof ViewerMessages, other: keyof ViewerMessages];

	const ANY_LABELS: PickLabels = ['geometryPickAnyOne', 'geometryPickAnyOther'];
	const KIND_LABELS: Record<PickKind, PickLabels> = {
		point: ['geometryPickPointOne', 'geometryPickPointOther'],
		pointCloud: ['geometryPickPointCloudOne', 'geometryPickPointCloudOther'],
		curve: ['geometryPickCurveOne', 'geometryPickCurveOther'],
		line: ['geometryPickLineOne', 'geometryPickLineOther'],
		plane: ['geometryPickPlaneOne', 'geometryPickPlaneOther'],
		surface: ['geometryPickSurfaceOne', 'geometryPickSurfaceOther'],
		polysurface: ['geometryPickPolysurfaceOne', 'geometryPickPolysurfaceOther'],
		extrusion: ['geometryPickExtrusionOne', 'geometryPickExtrusionOther'],
		mesh: ['geometryPickMeshOne', 'geometryPickMeshOther'],
		subd: ['geometryPickSubdOne', 'geometryPickSubdOther'],
		block: ['geometryPickBlockOne', 'geometryPickBlockOther']
	};

	const pickLabel = $derived.by(() => {
		const [one, other] = kinds?.length === 1 ? KIND_LABELS[kinds[0]] : ANY_LABELS;
		return t[atMost === 1 ? one : other];
	});

	// Rhino's command line prompts during the pick; the page keeps the button from being pressed
	// twice and says where to look.
	let picking = $state(false);
	// The last pick or clear wins over what the host reported when the page loaded.
	let local = $state<string | null | undefined>(undefined);
	const shown = $derived(local !== undefined ? local : (summary ?? null));

	$effect(() =>
		watchSummary?.((held) => {
			local = held;
		})
	);

	async function pick(onPick: () => Promise<GeometryPickResult>) {
		picking = true;
		try {
			const result = await onPick();
			if (result.outcome === 'picked') local = result.summary;
			else if (result.outcome === 'failed') onError?.(result.error);
		} finally {
			picking = false;
		}
	}

	// The field label points at inputId: the button where there is one, else an <output>, which
	// unlike a <span> can be labelled.
	const readout = $derived(onPick ? 'span' : 'output');

	function clear(onClear: () => void) {
		local = null;
		onClear();
	}
</script>

<div class="gap-2 min-w-0 flex flex-wrap items-center">
	{#if onPick}
		<Button
			id={inputId}
			variant="outline"
			size="sm"
			onclick={() => pick(onPick)}
			disabled={disabled || picking}
		>
			{shown ? t.geometryPickAgain : pickLabel}
		</Button>
	{/if}
	{#if picking}
		<span class="text-sm min-w-0 text-muted-foreground" role="status">{t.geometryPicking}</span>
	{:else if shown}
		<svelte:element
			this={readout}
			id={onPick ? undefined : inputId}
			class="text-sm min-w-0 truncate text-foreground"
		>
			{shown}
		</svelte:element>
		{#if onClear}
			<Button variant="ghost" size="sm" onclick={() => clear(onClear)} {disabled}>
				{t.geometryClear}
			</Button>
		{/if}
	{:else if !onPick}
		<output id={inputId} class="text-sm min-w-0 text-muted-foreground"
			>{t.geometryPickInPanel}</output
		>
	{/if}
</div>
