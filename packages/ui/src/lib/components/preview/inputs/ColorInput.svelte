<script lang="ts">
	import { untrack } from 'svelte';
	import { Check, Pipette } from '@lucide/svelte';
	import * as Popover from '$lib/components/primitives/popover';
	import { Input } from '$lib/components/primitives/input';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import { formatMessage } from '$lib/i18n/messages';
	import { debounce } from '$lib/utils/debounce';
	import {
		contrastRatio,
		hexToHsv,
		hsvToHex,
		normalizeHex,
		type Hsv
	} from '$lib/utils/color-space';

	interface Props {
		inputId: string;
		value?: string;
		onChange: (value: string) => void;
		disabled?: boolean;
	}

	let { inputId, value = '#000000', onChange, disabled = false }: Props = $props();

	const PRESETS = [
		'#000000',
		'#ffffff',
		'#9ca3af',
		'#ef4444',
		'#f97316',
		'#eab308',
		'#22c55e',
		'#14b8a6',
		'#3b82f6',
		'#8b5cf6',
		'#ec4899',
		'#78350f'
	];

	interface EyeDropperApi {
		open(): Promise<{ sRGBHex: string }>;
	}
	const eyeDropperCtor = (globalThis as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	const parse = (hex: string): Hsv => hexToHsv(normalizeHex(hex) ?? '#000000')!;

	let hsv = $state<Hsv>(untrack(() => parse(value)));
	let draft = $state('');
	let hexError = $state(false);
	let areaEl = $state<HTMLElement | null>(null);

	const currentHex = $derived(hsvToHex(hsv));
	const hueColor = $derived(hsvToHex({ h: hsv.h, s: 1, v: 1 }));

	// An external value only replaces the picker's state when it names a different color.
	// Rebuilding from the hex alone would reset the hue whenever s or v hits 0.
	$effect(() => {
		const next = normalizeHex(value) ?? '#000000';
		if (next !== untrack(() => currentHex)) hsv = parse(next);
	});

	$effect(() => {
		draft = currentHex;
		hexError = false;
	});

	// Dragging only updates local state; the host sees one change per gesture, since each
	// change can trigger a solve.
	function commit() {
		commitDebounced.cancel();
		if (currentHex !== normalizeHex(value)) onChange(currentHex);
	}
	const commitDebounced = debounce(commit, 150);

	const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

	function setFromPointer(e: PointerEvent) {
		if (!areaEl) return;
		const rect = areaEl.getBoundingClientRect();
		hsv = {
			h: hsv.h,
			s: clamp01((e.clientX - rect.left) / rect.width),
			v: clamp01(1 - (e.clientY - rect.top) / rect.height)
		};
	}

	function onAreaPointerDown(e: PointerEvent) {
		if (disabled || e.button !== 0) return;
		e.preventDefault();
		areaEl?.focus();
		areaEl?.setPointerCapture(e.pointerId);
		setFromPointer(e);
	}

	function onAreaPointerMove(e: PointerEvent) {
		if (areaEl?.hasPointerCapture(e.pointerId)) setFromPointer(e);
	}

	function onAreaPointerUp(e: PointerEvent) {
		if (!areaEl?.hasPointerCapture(e.pointerId)) return;
		areaEl.releasePointerCapture(e.pointerId);
		commit();
	}

	function onAreaKeydown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.01;
		let { s, v } = hsv;
		switch (e.key) {
			case 'ArrowLeft':
				s -= step;
				break;
			case 'ArrowRight':
				s += step;
				break;
			case 'ArrowUp':
				v += step;
				break;
			case 'ArrowDown':
				v -= step;
				break;
			case 'PageUp':
				v += 0.1;
				break;
			case 'PageDown':
				v -= 0.1;
				break;
			default:
				return;
		}
		e.preventDefault();
		hsv = { h: hsv.h, s: clamp01(s), v: clamp01(v) };
		commitDebounced();
	}

	function onHueInput(e: Event) {
		hsv = { ...hsv, h: Number((e.currentTarget as HTMLInputElement).value) };
	}

	function applyHex(hex: string) {
		hsv = parse(hex);
		commit();
	}

	function commitDraft() {
		const hex = normalizeHex(draft);
		if (!hex) {
			hexError = true;
			return;
		}
		hexError = false;
		applyHex(hex);
		draft = hex;
	}

	function onHexKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitDraft();
		}
	}

	function onHexBlur() {
		if (normalizeHex(draft)) commitDraft();
		else {
			draft = currentHex;
			hexError = false;
		}
	}

	async function pickFromScreen() {
		if (!eyeDropperCtor) return;
		try {
			const { sRGBHex } = await new eyeDropperCtor().open();
			applyHex(sRGBHex);
		} catch {
			// The user dismissed the eyedropper.
		}
	}

	const checkOn = (hex: string) =>
		(contrastRatio(hex, '#000000') ?? 0) > (contrastRatio(hex, '#ffffff') ?? 0)
			? 'text-black'
			: 'text-white';
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				id={inputId}
				{disabled}
				aria-label={formatMessage(t.colorPick, { color: currentHex })}
				class="h-9 gap-2.5 px-2.5 shadow-xs max-w-48 flex w-full cursor-pointer items-center rounded-md border border-input bg-background text-left outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
			>
				<span
					class="size-5 shrink-0 rounded-md bg-(--swatch) ring-1 ring-border ring-inset"
					style:--swatch={currentHex}
				></span>
				<span class="font-mono text-sm text-muted-foreground">{currentHex}</span>
			</button>
		{/snippet}
	</Popover.Trigger>

	<Popover.Content align="start">
		<div
			bind:this={areaEl}
			role="slider"
			tabindex={disabled ? -1 : 0}
			aria-label={t.colorArea}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(hsv.v * 100)}
			aria-valuetext={formatMessage(t.colorAreaValue, {
				s: Math.round(hsv.s * 100),
				v: Math.round(hsv.v * 100)
			})}
			aria-disabled={disabled}
			class="color-area h-36 relative w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring"
			style:--hue={hueColor}
			onpointerdown={onAreaPointerDown}
			onpointermove={onAreaPointerMove}
			onpointerup={onAreaPointerUp}
			onpointercancel={onAreaPointerUp}
			onkeydown={onAreaKeydown}
		>
			<span
				class="color-thumb size-4 border-white pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-(--swatch)"
				style:--x="{hsv.s * 100}%"
				style:--y="{(1 - hsv.v) * 100}%"
				style:--swatch={currentHex}
			></span>
		</div>

		<input
			type="range"
			class="color-hue"
			min="0"
			max="360"
			step="1"
			aria-label={t.colorHue}
			value={Math.round(hsv.h)}
			{disabled}
			oninput={onHueInput}
			onchange={commit}
		/>

		<div class="gap-2 flex items-start">
			<div class="min-w-0 flex-1">
				<Input
					type="text"
					aria-label={t.colorHex}
					aria-invalid={hexError}
					aria-describedby={hexError ? `${inputId}-hex-error` : undefined}
					autocomplete="off"
					spellcheck={false}
					maxlength={7}
					{disabled}
					bind:value={draft}
					onkeydown={onHexKeydown}
					onblur={onHexBlur}
				/>
			</div>
			{#if eyeDropperCtor}
				<button
					type="button"
					{disabled}
					aria-label={t.colorEyedropper}
					title={t.colorEyedropper}
					class="size-9 flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background outline-none hover:bg-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
					onclick={pickFromScreen}
				>
					<Pipette class="size-4" aria-hidden="true" />
				</button>
			{/if}
		</div>
		{#if hexError}
			<p id="{inputId}-hex-error" role="alert" class="text-xs text-destructive">
				{t.colorHexInvalid}
			</p>
		{/if}

		<div role="group" aria-label={t.colorPresets} class="gap-1.5 grid grid-cols-6">
			{#each PRESETS as preset (preset)}
				{@const selected = preset === currentHex}
				<button
					type="button"
					{disabled}
					aria-label={preset}
					aria-pressed={selected}
					class="h-6 flex cursor-pointer items-center justify-center rounded-md bg-(--swatch) ring-1 ring-border outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed"
					style:--swatch={preset}
					onclick={() => applyHex(preset)}
				>
					{#if selected}
						<Check class="size-3.5 {checkOn(preset)}" aria-hidden="true" />
					{/if}
				</button>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>

<style>
	.color-area {
		background-color: var(--hue);
		background-image:
			linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
	}
	.color-thumb {
		left: var(--x);
		top: var(--y);
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
	}
	.color-hue {
		appearance: none;
		-webkit-appearance: none;
		height: 0.75rem;
		width: 100%;
		margin: 0;
		border-radius: 9999px;
		cursor: pointer;
		outline: none;
		background: linear-gradient(
			to right,
			#f00 0%,
			#ff0 16.67%,
			#0f0 33.33%,
			#0ff 50%,
			#00f 66.67%,
			#f0f 83.33%,
			#f00 100%
		);
	}
	.color-hue::-webkit-slider-thumb {
		-webkit-appearance: none;
		height: 1rem;
		width: 1rem;
		border-radius: 9999px;
		border: 2px solid #fff;
		background: transparent;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
	}
	.color-hue::-moz-range-thumb {
		height: 1rem;
		width: 1rem;
		box-sizing: border-box;
		border-radius: 9999px;
		border: 2px solid #fff;
		background: transparent;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
	}
	.color-hue:focus-visible {
		box-shadow: 0 0 0 3px var(--ring);
	}
	.color-hue:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
