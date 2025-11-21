<script lang="ts">
	interface Props {
		name: string;
		description: string;
		disabled?: boolean;
		onclick: () => void;
	}

	let { name, description, disabled = false, onclick }: Props = $props();
</script>

<button
	{onclick}
	{disabled}
	class="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-sky-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-500"
>
	<h3 class="mb-1 font-semibold text-slate-900 dark:text-white">{name}</h3>
	<p class="text-sm text-slate-600 dark:text-slate-400">{description}</p>
</button>
