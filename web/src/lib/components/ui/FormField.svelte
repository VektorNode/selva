<script lang="ts">
	import type { Snippet } from 'svelte';

	interface FormFieldProps {
		label: string;
		description?: string;
		error?: string;
		required?: boolean;
		tooltip?: string;
		class?: string;
		children: Snippet;
	}

	let {
		label,
		description,
		error,
		required = false,
		tooltip,
		class: className = '',
		children
	}: FormFieldProps = $props();

	const fieldId = $derived(`field-${Math.random().toString(36).substr(2, 9)}`);
</script>

<div class={`mb-4 ${className}`}>
	<label for={fieldId} class="block text-sm font-medium text-gray-700 mb-1.5">
		{label}
		{#if required}
			<span class="text-red-500">*</span>
		{/if}
		{#if tooltip}
			<span class="ml-1 text-gray-400 cursor-help" title={tooltip}>ⓘ</span>
		{/if}
	</label>

	{#if description}
		<p class="text-sm text-gray-500 mb-2">{description}</p>
	{/if}

	<div id={fieldId}>
		{@render children()}
	</div>

	{#if error}
		<p class="mt-1.5 text-sm text-red-600">{error}</p>
	{/if}
</div>
