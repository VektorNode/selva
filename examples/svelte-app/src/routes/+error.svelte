<script>
	import { page } from '$app/state';

	// Reactive error data using runes
	let status = $derived(page.status || 500);
	let error = $derived(page.error);
	let message = $derived(
		error?.message || 'An unexpected error has occurred. Please try again later.'
	);
	let code = $derived(error?.code);
	let context = $derived(error?.context);
	let solutions = $derived(error?.solutions);
</script>

<svelte:head>
	<title>{status} Error | Compute Example App</title>
</svelte:head>

<div
	class="bg-linear-to-br flex min-h-screen items-center justify-center from-gray-50 to-gray-100 px-4"
>
	<div class="w-full max-w-2xl text-center">
		<!-- Error Icon -->
		<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
			<svg class="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
				/>
			</svg>
		</div>

		<!-- Error Code -->
		<h1 class="mb-2 text-6xl font-bold text-gray-900">{status}</h1>

		<!-- Error Title -->
		<h2 class="mb-4 text-xl font-semibold text-gray-700">
			{status === 400
				? 'Configuration Error'
				: status === 503
					? 'Server Unavailable'
					: 'Something went wrong'}
		</h2>

		<!-- Error Message -->
		<p class="mb-6 leading-relaxed text-gray-600">{message}</p>

		<!-- Error Code Badge -->
		{#if code}
			<div
				class="mb-6 inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
			>
				<span class="mr-1">🏷️</span>
				Error Code: {code}
			</div>
		{/if}

		<!-- Solutions Section -->
		{#if solutions && solutions.length > 0}
			<div class="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-6 text-left">
				<div class="flex items-start">
					<svg
						class="mr-3 mt-0.5 h-5 w-5 shrink-0 text-blue-600"
						fill="currentColor"
						viewBox="0 0 20 20"
					>
						<path
							fill-rule="evenodd"
							d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
							clip-rule="evenodd"
						/>
					</svg>
					<div class="flex-1">
						<h3 class="mb-3 text-sm font-medium text-blue-800">Suggested Solutions</h3>
						<ul class="space-y-2">
							{#each solutions as solution}
								<li class="text-sm text-blue-700">{solution}</li>
							{/each}
						</ul>
					</div>
				</div>
			</div>
		{/if}

		<!-- Context Details (expandable) -->
		{#if context}
			<details class="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left">
				<summary class="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
					🔍 Technical Details
				</summary>
				<pre class="mt-3 overflow-x-auto text-xs text-gray-600">{JSON.stringify(
						context,
						null,
						2
					)}</pre>
			</details>
		{/if}

		<!-- Server Error Details for 503 -->
		{#if status === 503}
			<div class="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-left">
				<div class="flex items-start">
					<svg
						class="mr-3 mt-0.5 h-5 w-5 shrink-0 text-amber-600"
						fill="currentColor"
						viewBox="0 0 20 20"
					>
						<path
							fill-rule="evenodd"
							d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
					<div>
						<h3 class="mb-1 text-sm font-medium text-amber-800">Server Issue</h3>
						<p class="text-sm text-amber-700">
							The compute server appears to be down or unreachable. Please try refreshing the page
							or contact support if the issue persists.
						</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- Action Buttons -->
		<div class="space-y-3">
			<button
				onclick={() => window.location.reload()}
				class="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
			>
				<svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				Try Again
			</button>

			<a
				href="/"
				class="inline-flex w-full items-center justify-center rounded-lg bg-gray-900 px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
			>
				<svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
					/>
				</svg>
				Go back to Home
			</a>
		</div>
	</div>
</div>
