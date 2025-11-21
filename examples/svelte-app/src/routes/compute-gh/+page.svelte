<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const EXAMPLE_GH_FILES = [
		{
			name: 'compute_default',
			description: 'Default Grasshopper compute example'
		},
		{
			name: 'compute_default1',
			description: 'Alternative compute configuration'
		},
		{
			name: 'output_test',
			description: 'Test various output types'
		},
		{
			name: 'point-attractor',
			description: 'Dynamic point attractor surface'
		}
	];
</script>

<div
	class="bg-linear-to-b min-h-screen from-slate-50 to-white p-8 dark:from-slate-900 dark:to-slate-800"
>
	<div class="mx-auto max-w-4xl">
		<header class="mb-12">
			<h1 class="mb-2 text-4xl font-bold text-slate-900 dark:text-white">
				Grasshopper <span class="text-sky-600">Examples</span>
			</h1>
			<p class="text-slate-600 dark:text-slate-400">
				Explore and interact with Grasshopper definitions via Rhino Compute
			</p>
		</header>

		<nav class="mb-8 grid gap-4 sm:grid-cols-2">
			{#each EXAMPLE_GH_FILES as example}
				<a
					href={`/compute-gh/${example.name}`}
					class="group rounded-lg border border-slate-200 bg-white p-6 transition hover:border-sky-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-500"
				>
					<div class="mb-2 flex items-start justify-between">
						<h2
							class="font-semibold text-slate-900 group-hover:text-sky-600 dark:text-white dark:group-hover:text-sky-400"
						>
							{example.name}
						</h2>
						<span
							class="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300"
						>
							GH
						</span>
					</div>
					<p class="text-sm text-slate-600 dark:text-slate-400">
						{example.description}
					</p>
				</a>
			{/each}
		</nav>

		<footer
			class="border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
		>
			<a href="/" class="text-sky-600 hover:underline"> ← Back to home </a>
		</footer>
	</div>
</div>
