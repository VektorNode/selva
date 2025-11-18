<script lang="ts">
	interface Option {
		value: string | number;
		label: string;
	}

	interface SelectProps {
		options: Option[];
		value?: string | number;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		onchange?: (e: Event & { currentTarget: HTMLSelectElement }) => void;
		class?: string;
	}

	let {
		options,
		value = $bindable(),
		placeholder,
		disabled = false,
		required = false,
		onchange,
		class: className = ''
	}: SelectProps = $props();

	const baseClasses =
		'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed bg-white';

	const combinedClasses = $derived(`${baseClasses} ${className}`);
</script>

<select bind:value {disabled} {required} {onchange} class={combinedClasses}>
	{#if placeholder}
		<option value="" disabled selected>{placeholder}</option>
	{/if}
	{#each options as option}
		<option value={option.value}>{option.label}</option>
	{/each}
</select>
