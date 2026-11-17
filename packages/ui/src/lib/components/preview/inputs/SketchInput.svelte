<script lang="ts">
	import { untrack } from 'svelte';
	import { FileUp } from '@lucide/svelte';
	import { curveLength } from '@selvajs/sketch/model';
	import { formatLength, type DrawMode } from '@selvajs/sketch/tool';
	import { Button } from '#lib/components/primitives/button/index.js';
	import { Checkbox } from '#lib/components/primitives/checkbox/index.js';
	import { Input } from '#lib/components/primitives/input/index.js';
	import { Label } from '#lib/components/primitives/label/index.js';
	import { toast } from '#lib/components/primitives/sonner/index.js';
	import type { SketchController } from '#lib/contexts/sketchContext.svelte.js';
	import { CurveImportError, MAX_IMPORTED_CURVES } from '#lib/features/sketch/curve-import.js';
	import { getLocaleContext } from '#lib/i18n/localeContext.svelte.js';
	import { formatCount, formatMessage, type ViewerMessages } from '#lib/i18n/messages.js';
	import { pickFile } from '#lib/utils/host-files.js';

	interface Props {
		inputId: string;
		paramId: string;
		sketch: SketchController;
		/** A Get Line input: straight lines only. */
		linesOnly?: boolean;
		disabled?: boolean;
	}

	let { inputId, paramId, sketch, linesOnly = false, disabled = false }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	const view = $derived(sketch.view(paramId));
	const mode = $derived(view.state.mode);
	const unit = $derived(sketch.unitSuffix);

	const DRAW_LABELS: Record<DrawMode, keyof ViewerMessages> = {
		line: 'curveDrawLine',
		polyline: 'curveDrawPolyline',
		nurbs: 'curveDrawCurve'
	};
	const HINTS: Record<DrawMode | 'move', keyof ViewerMessages> = {
		line: 'curveHintLine',
		polyline: 'curveHintPolyline',
		nurbs: 'curveHintCurve',
		move: 'curveHintMove'
	};
	const modes = $derived<DrawMode[]>(linesOnly ? ['line'] : ['line', 'polyline', 'nurbs']);

	const summary = $derived.by(() => {
		const count = view.curves.length;
		if (count === 0) return '';
		const length = view.curves.reduce((sum, curve) => sum + curveLength(curve), 0);
		const counted = linesOnly
			? formatCount(count, t.curveCountLineOne, t.curveCountLineOther)
			: formatCount(count, t.curveCountOne, t.curveCountOther);
		return `${counted} · ${formatLength(length, unit)}`;
	});

	// A number field's own state: writing the parsed value straight back would erase "0." while
	// the user is still typing 0.5.
	let grid = $state<number | null>(untrack(() => sketch.gridStep || null));
	$effect(() => {
		sketch.gridStep = grid ?? 0;
	});

	let importing = $state(false);

	async function importFile() {
		const file = await pickFile({ accept: sketch.importAccept });
		if (!file) return;
		importing = true;
		try {
			const { curves, skipped, overLimit } = await sketch.importFile(paramId, file);
			if (curves.length === 0) toast.error(t.curveImportEmpty);
			else if (overLimit > 0) {
				toast.warning(
					formatMessage(
						curves.length === 1 ? t.curveImportOverLimitOne : t.curveImportOverLimitOther,
						{
							max: curves.length,
							count: curves.length + overLimit
						}
					)
				);
			} else if (skipped > 0) {
				toast.warning(formatCount(skipped, t.curveImportSkippedOne, t.curveImportSkippedOther));
			}
		} catch (error) {
			const reason = error instanceof CurveImportError ? error.reason : 'unreadable';
			toast.error(
				reason === 'tooMany'
					? formatMessage(t.curveImportTooMany, { max: MAX_IMPORTED_CURVES })
					: reason === 'unsupported'
						? t.curveImportUnsupported
						: t.curveImportFailed
			);
		} finally {
			importing = false;
		}
	}

	function draw(next: DrawMode, event: MouseEvent) {
		// Enter and Space belong to the drawing now, not to this button.
		(event.currentTarget as HTMLElement).blur();
		sketch.draw(paramId, next);
	}
</script>

<div class="gap-2 min-w-0 flex flex-col">
	{#if mode}
		<output id={inputId} class="text-sm min-w-0 text-muted-foreground">{t[HINTS[mode]]}</output>
		{#if view.state.typed}
			<span class="text-sm font-mono text-foreground">{view.state.typed} {unit}</span>
		{/if}
		<div class="gap-x-3 gap-y-2 min-w-0 flex flex-wrap items-center">
			<div class="gap-2 flex items-center">
				<Label for="{inputId}-grid">{t.curveGrid}</Label>
				<Input
					id="{inputId}-grid"
					type="number"
					min="0"
					step="any"
					class="w-24"
					bind:value={grid}
					placeholder={t.curveGridOff}
				/>
				{#if unit}<span class="text-sm text-muted-foreground">{unit}</span>{/if}
			</div>
			<div class="gap-2 flex items-center">
				<Checkbox
					id="{inputId}-dimensions"
					checked={sketch.showDimensions}
					onCheckedChange={(state) => {
						sketch.showDimensions = state === true;
					}}
				/>
				<Label for="{inputId}-dimensions">
					{t.curveDimensions}
				</Label>
			</div>
			<Button size="sm" onclick={() => sketch.finish(paramId)}>{t.curveDone}</Button>
		</div>
	{:else}
		<div class="gap-2 min-w-0 flex flex-wrap items-center">
			{#each modes as drawMode (drawMode)}
				<Button
					variant="outline"
					size="sm"
					onclick={(event: MouseEvent) => draw(drawMode, event)}
					disabled={disabled || !sketch.canDraw}
				>
					{t[DRAW_LABELS[drawMode]]}
				</Button>
			{/each}
			<Button
				variant="outline"
				size="sm"
				onclick={importFile}
				disabled={disabled || !sketch.canImport || importing}
			>
				<FileUp />
				{t.curveImport}
			</Button>
		</div>
		<!-- The field label points at this readout, not at a button: on one, it would replace the button's own name. -->
		<div class="gap-2 min-w-0 flex flex-wrap items-center">
			<output
				id={inputId}
				class="text-sm min-w-0 truncate {summary ? 'text-foreground' : 'text-muted-foreground'}"
			>
				{sketch.canImport ? summary || t.curveEmpty : t.curveNeedsSolve}
			</output>
			{#if summary}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => sketch.move(paramId)}
					disabled={disabled || !sketch.canDraw}
				>
					{t.curveEdit}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => sketch.reset(paramId)} {disabled}>
					{t.curveReset}
				</Button>
			{/if}
		</div>
	{/if}
</div>
