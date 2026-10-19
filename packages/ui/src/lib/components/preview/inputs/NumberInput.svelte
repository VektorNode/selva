<script lang="ts">
	import type { NumberWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/primitives/input';
	import { Slider } from '$lib/components/primitives/slider';
	import * as InputGroup from '$lib/components/primitives/input-group';
	import { Separator } from '$lib/components/primitives/separator';
	import * as Field from '$lib/components/primitives/field';

	interface Props {
		inputId: string;
		value?: number;
		config?: NumberWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value = $bindable(), config, onChange, disabled = false }: Props = $props();

	let validationError = $state<string | null>(null);

	const min = $derived(config?.minimum ?? 0);
	const max = $derived(config?.maximum ?? 100);
	const step = $derived(config?.stepSize ?? 1);
	const numValue = $derived(typeof value === 'number' ? value : min);

	const commitDebounced = debounce((newValue: SupportedTypes) => onChange(newValue), 400);
	const commitSliderDebounced = debounce((newValue: SupportedTypes) => onChange(newValue), 150);

	function validateNumber(val: number): string | null {
		if (config?.minimum !== undefined && val < config.minimum)
			return `Minimum value is ${config.minimum}`;
		if (config?.maximum !== undefined && val > config.maximum)
			return `Maximum value is ${config.maximum}`;
		return null;
	}

	function handleNumberInput(newValue: number) {
		const error = validateNumber(newValue);
		validationError = error;
		if (!error) {
			value = newValue;
			commitDebounced(newValue);
		}
	}

	// bits-ui builds an array of every step and rebuilds a tick object per step on each value
	// change, so a fine-grained range freezes the drag. Past this many steps the track drives a
	// coarse proxy scale instead; the number box next to it still sets any exact value.
	const MAX_TRACK_STEPS = 1000;
	const FINE_DRAG_FACTOR = 10;
	const stepCount = $derived((max - min) / step);
	const useProxyTrack = $derived(
		step > 0 && Number.isFinite(stepCount) && stepCount > MAX_TRACK_STEPS
	);
	const trackMin = $derived(useProxyTrack ? 0 : min);
	const trackMax = $derived(useProxyTrack ? MAX_TRACK_STEPS : max);
	const stepPrecision = $derived((String(step).split('.')[1] ?? '').length);

	let dragging = false;
	let shiftHeld = false;
	let lastTrack: number | null = null;
	let fineAnchor: { track: number; value: number } | null = null;

	function snapToStep(v: number): number {
		const clamped = Math.min(max, Math.max(min, v));
		if (!(step > 0)) return clamped;
		const snapped = min + Math.round((clamped - min) / step) * step;
		return Math.min(max, Number(snapped.toFixed(stepPrecision)));
	}

	function toTrack(v: number): number {
		return useProxyTrack ? Math.round(((v - min) / (max - min)) * MAX_TRACK_STEPS) : v;
	}

	function trackSpanToValue(trackDelta: number): number {
		return (trackDelta / (trackMax - trackMin)) * (max - min);
	}

	// bits-ui maps the pointer to an absolute track position, so fine drag works in deltas: the
	// value moves FINE_DRAG_FACTOR times slower than the pointer from where Shift took effect.
	function setFromTrack(track: number) {
		if (max <= min) return;
		let newValue: number;
		if (dragging && shiftHeld) {
			fineAnchor ??= { track: lastTrack ?? track, value: numValue };
			newValue = snapToStep(
				fineAnchor.value + trackSpanToValue(track - fineAnchor.track) / FINE_DRAG_FACTOR
			);
		} else {
			fineAnchor = null;
			newValue = snapToStep(min + trackSpanToValue(track - trackMin));
		}
		lastTrack = track;
		value = newValue;
		commitSliderDebounced(newValue);
	}

	function startDrag(e: PointerEvent) {
		dragging = true;
		shiftHeld = e.shiftKey;
		lastTrack = null;
		fineAnchor = null;
	}

	function setShift(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftHeld = e.type === 'keydown';
	}

	const decimals = $derived(Math.max(0, -Math.floor(Math.log10(step))));

	function commitTypedValue(input: HTMLInputElement) {
		const parsed = parseFloat(input.value);
		if (isNaN(parsed)) {
			input.value = numValue.toFixed(decimals);
			return;
		}
		const clamped = Math.min(max, Math.max(min, parsed));
		input.value = clamped.toFixed(decimals);
		if (clamped === value) return;
		value = clamped;
		onChange(clamped);
	}
</script>

<svelte:window
	onkeydown={setShift}
	onkeyup={setShift}
	onpointerup={() => (dragging = false)}
	onblur={() => (shiftHeld = dragging = false)}
/>

{#if config?.renderAsSlider}
	<!-- Value and track share one box, the height of a number input, so mixed rows line up and
	     a value can't be read as belonging to the neighbouring slider. -->
	<InputGroup.Root>
		<InputGroup.Input
			id={inputId}
			type="number"
			class="w-18 flex-none"
			value={numValue.toFixed(decimals)}
			{min}
			{max}
			{step}
			{disabled}
			onchange={(e) => commitTypedValue(e.currentTarget)}
			onkeydown={(e) => {
				if (e.key === 'Enter') e.currentTarget.blur();
			}}
		/>
		<Separator orientation="vertical" />
		<div class="px-3.5 min-w-0 flex flex-1 items-center" onpointerdowncapture={startDrag}>
			<!-- A function binding, not value + onValueChange: when a fine drag leaves the value
			     unchanged, the thumb must stay put instead of following the pointer. -->
			<Slider
				type="single"
				bind:value={() => toTrack(numValue), setFromTrack}
				min={trackMin}
				max={trackMax}
				step={useProxyTrack ? 1 : step}
				title="Hold Shift to drag finely"
				{disabled}
			/>
		</div>
	</InputGroup.Root>
{:else}
	<Input
		id={inputId}
		type="number"
		value={numValue}
		min={config?.minimum}
		max={config?.maximum}
		{step}
		placeholder={config?.placeholder}
		data-invalid={validationError ? true : undefined}
		aria-invalid={validationError ? true : undefined}
		{disabled}
		oninput={() => (validationError = null)}
		onchange={(e) => {
			const newValue = parseFloat((e.currentTarget as HTMLInputElement).value);
			if (!isNaN(newValue)) handleNumberInput(newValue);
		}}
		onblur={(e) => {
			const newValue = parseFloat((e.currentTarget as HTMLInputElement).value);
			if (!isNaN(newValue)) {
				const error = validateNumber(newValue);
				validationError = error;
				if (!error) {
					value = newValue;
					onChange(newValue);
				}
			}
		}}
	/>
{/if}

{#if validationError}
	<Field.Error>{validationError}</Field.Error>
{/if}
