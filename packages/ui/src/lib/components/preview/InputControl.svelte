<script lang="ts">
	import type {
		InputLayoutItem,
		FileInputWidgetConfig,
		DynamicValueListWidgetConfig,
		DropdownWidgetConfig,
		SupportedTypes
	} from '@selvajs/schemas';
	import {
		isNumberWidget,
		isTextWidget,
		isDropdownWidget,
		isDynamicValueListWidget,
		isCheckboxWidget,
		isFileWidget,
		isColorWidget
	} from '@selvajs/schemas';
	import * as Field from '$lib/components/primitives/field';
	import HelpButton from './HelpButton.svelte';
	import {
		CheckboxInput,
		ChecklistInput,
		ColorInput,
		DropdownInput,
		FileInput,
		NumberInput,
		TextInput
	} from '$lib/components/preview/inputs';
	import { getClientSlot } from '$lib/contexts/clientSlotContext.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	interface Props {
		item: InputLayoutItem;
		value?: SupportedTypes;
		displayName?: string;
		/**
		 * `forceSolve` solves even in manual-solve mode. Used for system-initiated changes
		 * (e.g. pruning a vanished dynamic-list selection), where leaving the previous output
		 * on screen would misrepresent the input that now sits above it.
		 */
		onChange: (paramId: string, value: SupportedTypes, forceSolve?: boolean) => void;
		disabled?: boolean;
		/** Runtime-computed options for a dynamic value list input (name -> value). */
		dynamicOptions?: Record<string, string>;
	}

	let {
		item,
		value = $bindable(undefined),
		displayName,
		onChange,
		disabled = false,
		dynamicOptions
	}: Props = $props();

	const locale = getLocaleContext();

	const inputId = $derived(`input-${item.paramId}`);
	const label = $derived(displayName || item.displayName || item.paramId);

	// The 'hidden' presentation never reaches here — visible:false filters it out
	// upstream — so a client-sourced input here always means presentation === 'slot'.
	const isClientSlot = $derived.by(() => {
		const source = (item as { source?: { kind?: string; client?: { presentation?: string } } })
			.source;
		return source?.kind === 'client' && source.client?.presentation === 'slot';
	});
	const clientSlot = getClientSlot();

	// Sliders never show the hint: the track already conveys the bounds.
	const numberRangeHint = $derived.by(() => {
		if (!isNumberWidget(item)) return null;
		const cfg = item.config;
		if (cfg?.hideRange || cfg?.renderAsSlider) return null;
		const hasMin = typeof cfg?.minimum === 'number';
		const hasMax = typeof cfg?.maximum === 'number';
		if (!hasMin && !hasMax) return null;
		if (hasMin && hasMax) return `${cfg!.minimum} – ${cfg!.maximum}`;
		if (hasMin) return `≥ ${cfg!.minimum}`;
		return `≤ ${cfg!.maximum}`;
	});

	const showRangeInLabel = $derived(isNumberWidget(item) && numberRangeHint !== null);

	// Options from the last solve win over the author's seed list, so the control is empty
	// until the first solve unless defaultOptions is set.
	const dynamicListConfig = $derived(
		isDynamicValueListWidget(item)
			? (item.config as DynamicValueListWidgetConfig | undefined)
			: undefined
	);
	const dynamicListOptions = $derived<Record<string, string>>(
		dynamicOptions && Object.keys(dynamicOptions).length > 0
			? dynamicOptions
			: (Object.fromEntries(
					Object.entries(dynamicListConfig?.defaultOptions ?? {}).filter(
						(entry): entry is [string, string] => entry[1] !== undefined
					)
				) as Record<string, string>)
	);
	const dynamicListHasOptions = $derived(Object.keys(dynamicListOptions).length > 0);
	// As a dropdown config so DropdownInput/ChecklistInput can consume it unchanged.
	const dynamicListAsDropdownConfig = $derived<DropdownWidgetConfig>({
		options: dynamicListOptions,
		displayAs: dynamicListConfig?.displayAs ?? 'dropdown'
	});
	const hideDynamicListWhenEmpty = $derived(
		isDynamicValueListWidget(item) &&
			!dynamicListHasOptions &&
			(dynamicListConfig?.emptyBehavior ?? 'hide') === 'hide'
	);

	// When a dynamic value list recomputes, the selected value may no longer be an option.
	// Prune it so the control shows a valid option instead of rendering the orphaned raw
	// value as its own label. The user didn't pick this, so force a solve — otherwise a
	// manual-solve schema keeps the prior output on screen, making it look like the
	// auto-picked option produced it.
	//
	// INVARIANT: a dynamic value list must never dispatch an empty/null value to solve. An
	// empty selection reaches the definition as null/"", which throws NREs in downstream
	// geometry components (e.g. Bounding Rectangle) and nulls every output beyond them.
	// There is always at least one option, so every terminal state below resolves to one;
	// there is deliberately no "user cleared it, stay empty" path.
	//
	// LOOP BREAKER: a definition whose computed options DEPEND on the selection can oscillate
	// — auto-pick A → solve → new options exclude A → auto-pick B → solve → … Each cycle
	// force-solves and re-parses the (possibly multi-MB) options, freezing the tab: every
	// solve result blocks the main thread and the loop never yields. Bound consecutive
	// system-initiated picks; any real user commit resets the budget.
	const MAX_CONSECUTIVE_AUTO_PICKS = 3;
	let autoPickCount = 0;

	$effect(() => {
		if (!isDynamicValueListWidget(item) || !dynamicListHasOptions) return;
		const validValues = new Set(Object.values(dynamicListOptions));
		const firstOption = Object.values(dynamicListOptions)[0];
		const isValid = Array.isArray(value)
			? value.length > 0 && value.every((v) => typeof v === 'string' && validValues.has(v))
			: typeof value === 'string' && value !== '' && validValues.has(value);
		if (isValid) {
			// Settled on a valid option — refill the budget.
			autoPickCount = 0;
			return;
		}
		if (autoPickCount >= MAX_CONSECUTIVE_AUTO_PICKS) {
			console.warn(
				`[InputControl] dynamic value list "${item.paramId}": options keep invalidating the ` +
					`auto-picked selection (${autoPickCount} consecutive system picks) — the definition's ` +
					`options likely depend on the selection. Stopping auto-reconciliation to avoid a solve loop.`
			);
			return;
		}
		if (Array.isArray(value)) {
			const pruned = value.filter((v) => typeof v === 'string' && validValues.has(v));
			// Empty — never selected or fully pruned — falls back to the first option: a
			// checklist that solves empty produces the same null cascade as a single value.
			if (pruned.length !== value.length || value.length === 0) {
				autoPickCount++;
				onChange(item.paramId, pruned.length > 0 ? pruned : [firstOption], true);
			}
		} else if (typeof value !== 'string' || value === '' || !validValues.has(value)) {
			// Same fallback for a single value: never-selected and stale both resolve, never clear.
			autoPickCount++;
			onChange(item.paramId, firstOption, true);
		}
	});

	function commit(newValue: SupportedTypes) {
		// A real user pick re-arms the auto-pick budget.
		autoPickCount = 0;
		value = newValue;
		onChange(item.paramId, newValue);
	}
</script>

{#snippet labelText(forId?: string, tone: 'quiet' | 'strong' = 'quiet')}
	<Field.Label
		for={forId}
		id={forId ? `${forId}-label` : undefined}
		class="min-w-0 block break-words"
	>
		<span
			class={tone === 'quiet' ? 'font-normal text-muted-foreground' : 'font-normal text-foreground'}
			>{label}</span
		>
	</Field.Label>
{/snippet}

{#snippet helpButton()}
	{#if item.description}
		<HelpButton {label} description={item.description} />
	{/if}
{/snippet}

{#snippet fieldHeader(forId?: string)}
	<div class="gap-1.5 min-h-5 min-w-0 flex items-center">
		{@render labelText(forId)}
		{@render helpButton()}
		{#if showRangeInLabel}
			<span
				class="text-xs pl-2 ml-auto hidden shrink-0 whitespace-nowrap text-muted-foreground tabular-nums group-focus-within/field:inline"
			>
				{numberRangeHint}
			</span>
		{/if}
	</div>
{/snippet}

{#if isClientSlot}
	{#if clientSlot}
		<div role="group" class="group/field gap-1.5 min-w-0 flex flex-col">
			{@render fieldHeader()}
			{@render clientSlot({
				inputId: item.paramId,
				displayName: label,
				value,
				onValueChange: commit
			})}
		</div>
	{/if}
{:else if !hideDynamicListWhenEmpty}
	<div role="group" class="group/field gap-1.5 min-w-0 flex flex-col">
		{#if !isCheckboxWidget(item)}
			{@render fieldHeader(inputId)}
		{/if}

		{#if isNumberWidget(item)}
			{@const config = item.config}
			<NumberInput
				{inputId}
				labelId="{inputId}-label"
				value={typeof value === 'number' ? value : undefined}
				{config}
				onChange={commit}
				{disabled}
			/>
		{:else if isCheckboxWidget(item)}
			<CheckboxInput
				{inputId}
				value={typeof value === 'boolean' ? value : undefined}
				onChange={commit}
				{disabled}
			>
				{@render labelText(inputId, 'strong')}
				{@render helpButton()}
			</CheckboxInput>
		{:else if isTextWidget(item)}
			{@const config = item.config}
			<TextInput
				{inputId}
				value={typeof value === 'string' ? value : ''}
				{config}
				onChange={commit}
				{disabled}
			/>
		{:else if isDropdownWidget(item)}
			{@const config = item.config}
			{#if config.displayAs === 'checklist'}
				<ChecklistInput
					{inputId}
					value={Array.isArray(value)
						? (value as string[])
						: typeof value === 'string' && value
							? [value]
							: []}
					{config}
					onChange={commit}
					{disabled}
				/>
			{:else}
				<DropdownInput
					value={typeof value === 'string' ? value : ''}
					{config}
					onChange={commit}
					{disabled}
				/>
			{/if}
		{:else if isDynamicValueListWidget(item)}
			{#if dynamicListHasOptions}
				{#if dynamicListAsDropdownConfig.displayAs === 'checklist'}
					<ChecklistInput
						{inputId}
						value={Array.isArray(value)
							? (value as string[])
							: typeof value === 'string' && value
								? [value]
								: []}
						config={dynamicListAsDropdownConfig}
						onChange={commit}
						{disabled}
					/>
				{:else}
					<DropdownInput
						value={typeof value === 'string' ? value : ''}
						config={dynamicListAsDropdownConfig}
						onChange={commit}
						{disabled}
					/>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">{locale.messages.noOptionsYet}</p>
			{/if}
		{:else if isFileWidget(item)}
			{@const config = item.config as FileInputWidgetConfig}
			<FileInput
				value={typeof value === 'string' ? value : ''}
				acceptedFormats={config?.acceptedFormats ?? []}
				onChange={(newValue) => commit(newValue)}
				defaultInputMode={config?.defaultInputMode}
				allowedInputModes={config?.allowedInputModes}
			/>
		{:else if isColorWidget(item)}
			<ColorInput
				{inputId}
				value={typeof value === 'string' ? value : '#000000'}
				onChange={(newValue) => commit(newValue)}
			/>
		{/if}
	</div>
{/if}
