<script lang="ts">
	interface Props {
		result?: any;
		error?: string | null;
		executing?: boolean;
	}

	let { result = null, error = null, executing = false }: Props = $props();
</script>

{#if executing}
	<div
		class="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
	>
		<div class="flex items-center gap-3">
			<div
				class="h-5 w-5 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"
			></div>
			<span class="text-slate-700 dark:text-slate-300">Executing...</span>
		</div>
	</div>
{/if}

{#if result}
	<div
		class="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
	>
		<h3 class="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Result</h3>
		<pre
			class="overflow-x-auto rounded bg-slate-100 p-4 text-sm text-slate-800 dark:bg-slate-900 dark:text-slate-200">{JSON.stringify(
				result,
				null,
				2
			)}</pre>
	</div>
{/if}

{#if error}
	<div
		class="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20"
	>
		<p class="mb-1 font-medium text-red-800 dark:text-red-300">Error</p>
		<p class="text-sm text-red-700 dark:text-red-400">{error}</p>
	</div>
{/if}
