<script lang="ts">
	import type { TextWidgetConfig, SupportedTypes } from '$lib/types/generated';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/ui/input';
	import * as Field from '$lib/components/ui/field';

	interface Props {
		inputId: string;
		value?: string;
		config?: TextWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value = $bindable(), config, onChange, disabled = false }: Props = $props();

	let validationError = $state<string | null>(null);
	let currentValue = $state(value || '');

	const commitDebounced = debounce((newValue: SupportedTypes) => onChange(newValue), 400);

	function validateText(val: string): string | null {
		if (config?.maxLength && val.length > config.maxLength)
			return `Maximum ${config.maxLength} characters allowed`;
		if (config?.pattern) {
			try {
				if (!new RegExp(config.pattern).test(val))
					return config.customErrorMessage || 'Invalid format';
			} catch {
				return 'Invalid validation pattern configured';
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
	class={validationError ? 'border-destructive' : ''}
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
