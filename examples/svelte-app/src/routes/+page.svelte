<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const links = [
		{
			href: './compute',
			label: 'Compute Example',
			description: 'Basic Compute calls with rhino3dm'
		},
		{
			href: './compute-gh',
			label: 'Grasshopper Example',
			description: 'Evaluate full Grasshopper definitions',
			badge: 'GH'
		},
		{ href: './state', label: 'Server State', description: 'Inspect queues and workers' },
		{ href: './output-test', label: 'Testing GH Outputs', description: 'See gh definition outputs' }
	];
</script>

<div
	class="bg-linear-to-b min-h-screen from-slate-50 to-white p-8 dark:from-slate-900 dark:to-slate-800"
>
	<div class="mx-auto max-w-4xl">
		<header class="mb-12">
			<h1 class="mb-2 text-4xl font-bold text-slate-900 dark:text-white">
				Rhino<span class="text-sky-600">.Compute</span>
			</h1>
			<p class="text-slate-600 dark:text-slate-400">
				Example app for Rhino Compute and Grasshopper integrations
			</p>
			{#if data.isOnline}
				<p
					class="mt-2 rounded bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
				>
					Server is online
				</p>
			{:else}
				<p
					class="mt-2 rounded bg-red-100 px-3 py-1 text-sm font-semibold text-red-700 dark:bg-red-900 dark:text-red-300"
				>
					Server is offline
				</p>
			{/if}
		</header>

		<nav class="mb-8 grid gap-4 sm:grid-cols-2">
			{#each links as link}
				<a
					href={link.href}
					class="group rounded-lg border border-slate-200 bg-white p-6 transition hover:border-sky-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-500"
				>
					<div class="mb-2 flex items-start justify-between">
						<h2
							class="font-semibold text-slate-900 group-hover:text-sky-600 dark:text-white dark:group-hover:text-sky-400"
						>
							{link.label}
						</h2>
						{#if link.badge}
							<span
								class="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300"
							>
								{link.badge}
							</span>
						{/if}
					</div>
					<p class="text-sm text-slate-600 dark:text-slate-400">
						{link.description}
					</p>
				</a>
			{/each}
		</nav>

		<footer
			class="border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
		>
			<div class="flex items-center justify-between">
				<span>For testing and examples</span>
				<a
					href="https://github.com/your-org/rhino-compute-lib"
					rel="noopener noreferrer"
					class="text-sky-600 hover:underline"
				>
					GitHub →
				</a>
			</div>
		</footer>
	</div>
</div>
