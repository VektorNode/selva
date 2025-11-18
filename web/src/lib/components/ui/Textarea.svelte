<script lang="ts">
	interface TextareaProps {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		rows?: number;
		oninput?: (e: Event) => void;
		onchange?: (e: Event) => void;
		class?: string;
	}

	let {
		value = $bindable(),
		placeholder,
		disabled = false,
		required = false,
		rows = 3,
		oninput,
		onchange,
		class: className = ''
	}: TextareaProps = $props();

	const baseClasses =
		'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed resize-y';

	const combinedClasses = $derived(`${baseClasses} ${className}`);
</script>

<textarea
	bind:value
	{placeholder}
	{disabled}
	{required}
	{rows}
	{oninput}
	{onchange}
	class={combinedClasses}
></textarea>
