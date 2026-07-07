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
	import * as Dialog from '$lib/components/primitives/dialog';
	import { HelpCircle } from '@lucide/svelte';
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

	interface Props {
		item: InputLayoutItem;
		value?: SupportedTypes;
		displayName?: string;
		/**
		 * Commit a value. `forceSolve` requests a solve even in manual-solve mode — used for
		 * system-initiated reconciliation (e.g. pruning a vanished dynamic-list selection) where
		 * leaving the previous output on screen would misrepresent the now-changed input.
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

	const inputId = $derived(`input-${item.paramId}`);
	const label = $derived(displayName || item.displayName || item.paramId);

	// Client-sourced input set to render a host element in its place. The 'hidden'
	// presentation never reaches here (visible:false filters it out upstream), so a
	// client slot source means presentation === 'slot'.
	const isClientSlot = $derived.by(() => {
		const source = (item as { source?: { kind?: string; client?: { presentation?: string } } })
			.source;
		return source?.kind === 'client' && source.client?.presentation === 'slot';
	});
	const clientSlot = getClientSlot();

	// Number range hint — shown next to label for sliders, under the input for plain number fields.
	const numberRangeHint = $derived.by(() => {
		if (!isNumberWidget(item)) return null;
		const cfg = item.config;
		if (cfg?.hideRange) return null;
		const hasMin = typeof cfg?.minimum === 'number';
		const hasMax = typeof cfg?.maximum === 'number';
		if (!hasMin && !hasMax) return null;
		if (hasMin && hasMax) return `${cfg!.minimum} to ${cfg!.maximum}`;
		if (hasMin) return `≥ ${cfg!.minimum}`;
		return `≤ ${cfg!.maximum}`;
	});

	const showRangeInLabel = $derived(isNumberWidget(item) && numberRangeHint !== null);

	// Dynamic value list: computed options (from the last solve) take precedence over the
	// author's seed list. Empty until the first solve produces options, unless a default is set.
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

	// When a dynamic value list recomputes, a previously-selected value may no longer be an
	// available option. Prune the stale selection so the control shows a valid option instead
	// of rendering the orphaned raw value as its own label. This is a system-initiated change
	// (the user didn't pick the new option), so force a solve — otherwise manual-solve schemas
	// would keep the prior output on screen, making it look like the auto-picked option produced it.
	//
	// INVARIANT: a dynamic value list must never dispatch an empty/null value to solve. There
	// is always at least one option, and an empty selection reaches the definition as null/""
	// — which throws NREs in downstream geometry components (e.g. Bounding Rectangle) and nulls
	// every output beyond them. So every terminal state below resolves to a valid option; there
	// is deliberately no "user cleared it, stay empty" path.
	$effect(() => {
		if (!isDynamicValueListWidget(item) || !dynamicListHasOptions) return;
		const validValues = new Set(Object.values(dynamicListOptions));
		const firstOption = Object.values(dynamicListOptions)[0];
		if (Array.isArray(value)) {
			const pruned = value.filter((v) => typeof v === 'string' && validValues.has(v));
			// Empty (never selected or fully pruned) always falls back to the first option —
			// a checklist that solves empty produces the same null cascade as a single value.
			if (pruned.length !== value.length || value.length === 0) {
				onChange(item.paramId, pruned.length > 0 ? pruned : [firstOption], true);
			}
		} else if (typeof value !== 'string' || value === '' || !validValues.has(value)) {
			// Never-selected or stale single value — fall back to the first option.
			onChange(item.paramId, firstOption, true);
		}
	});

	function commit(newValue: SupportedTypes) {
		value = newValue;
		onChange(item.paramId, newValue);
	}
</script>

{#if isClientSlot}
	{#if clientSlot}
		<Field.Field>
			<Field.Label class="gap-2 flex items-center">
				{label}
				{#if item.description}
					<Dialog.Root>
						<Dialog.Trigger class="p-1 cursor-help opacity-60 transition-opacity hover:opacity-100">
							<HelpCircle size={16} />
						</Dialog.Trigger>
						<Dialog.Content class="sm:max-w-md">
							<Dialog.Header>
								<Dialog.Title>{label}</Dialog.Title>
								<Dialog.Description>{item.description}</Dialog.Description>
							</Dialog.Header>
						</Dialog.Content>
					</Dialog.Root>
				{/if}
			</Field.Label>
			{@render clientSlot({
				inputId: item.paramId,
				displayName: label,
				value,
				onValueChange: commit
			})}
		</Field.Field>
	{/if}
{:else if !hideDynamicListWhenEmpty}
	<Field.Field>
		<Field.Label for={inputId} class="gap-2 flex items-center">
			{label}
			{#if item.description}
				<Dialog.Root>
					<Dialog.Trigger class="p-1 cursor-help opacity-60 transition-opacity hover:opacity-100">
						<HelpCircle size={16} />
					</Dialog.Trigger>
					<Dialog.Content class="sm:max-w-md">
						<Dialog.Header>
							<Dialog.Title>{label}</Dialog.Title>
							<Dialog.Description>{item.description}</Dialog.Description>
						</Dialog.Header>
					</Dialog.Content>
				</Dialog.Root>
			{/if}
			{#if showRangeInLabel}
				<span class="text-xs font-normal text-muted-foreground">{numberRangeHint}</span>
			{/if}
		</Field.Label>

		{#if isNumberWidget(item)}
			{@const config = item.config}
			<NumberInput
				{inputId}
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
			/>
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
				<p class="text-sm text-muted-foreground">No options available yet.</p>
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
				value={typeof value === 'string' ? value : '#000000'}
				onChange={(newValue) => commit(newValue)}
			/>
		{/if}
	</Field.Field>
{/if}
