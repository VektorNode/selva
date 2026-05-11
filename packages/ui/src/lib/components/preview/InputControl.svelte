<script lang="ts">
	import type { InputLayoutItem, FileInputWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import {
		isNumberWidget,
		isTextWidget,
		isDropdownWidget,
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

	interface Props {
		item: InputLayoutItem;
		value?: SupportedTypes;
		displayName?: string;
		onChange: (paramId: string, value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let {
		item,
		value = $bindable(undefined),
		displayName,
		onChange,
		disabled = false
	}: Props = $props();

	// Stable ID — not reactive, computed once at component creation
	const inputId = $derived(`input-${item.paramId}`);
	const label = $derived(displayName || item.displayName || item.paramId);

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

	function commit(newValue: SupportedTypes) {
		value = newValue;
		onChange(item.paramId, newValue);
	}
</script>

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
