<script lang="ts">
	import type { TextWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/primitives/input';
	import * as Field from '$lib/components/primitives/field';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import { formatMessage } from '$lib/i18n/messages';

	interface Props {
		inputId: string;
		value?: string;
		config?: TextWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value = $bindable(), config, onChange, disabled = false }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	let validationError = $state<string | null>(null);
	let currentValue = $state(value || '');

	const commitDebounced = debounce((newValue: SupportedTypes) => onChange(newValue), 400);

	function validateText(val: string): string | null {
		if (config?.maxLength && val.length > config.maxLength)
			return formatMessage(t.maxLength, { max: config.maxLength });
		if (config?.pattern) {
			try {
				if (!new RegExp(config.pattern).test(val))
					return config.customErrorMessage || t.invalidFormat;
			} catch {
				return t.invalidPattern;
			}
		}
		return null;
	}

	function handleChange() {
		const error = validateText(currentValue);
		validationError = error;
		if (!error) {
			value = currentValue;
			commitDebounced(currentValue);
		}
	}
</script>

<Input
	id={inputId}
	type="text"
	bind:value={currentValue}
	placeholder={config?.placeholder}
	maxlength={config?.maxLength}
	data-invalid={validationError ? true : undefined}
	aria-invalid={validationError ? true : undefined}
	{disabled}
	oninput={() => {
		validationError = null;
		handleChange();
	}}
	onblur={(e) => {
		const val = (e.currentTarget as HTMLInputElement).value;
		const error = validateText(val);
		validationError = error;
		if (!error) {
			currentValue = val;
			value = val;
			onChange(val);
		}
	}}
/>

{#if validationError}
	<Field.Error>{validationError}</Field.Error>
{/if}
