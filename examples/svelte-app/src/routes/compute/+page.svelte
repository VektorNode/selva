<script lang="ts">
	import { onMount } from 'svelte';
	import ResultDisplay from './_components/ResultDisplay.svelte';
	import StatusBanner from './_components/StatusBanner.svelte';
	import TestButton from './_components/TestButton.svelte';
	import { computeTests, type TestResult } from '../../helpers/compute-geo-tests';
	import { getRhino, initializeRhino } from '../../helpers/rhino3dm';
	import RhinoCompute from 'compute-rhino3d';
	import { COMPUTE_URL, DEFAULT_API_KEY } from '$lib';

	let output: TestResult | null = $state(null);
	let error: string | null = $state(null);
	let loading = $state(true);
	let executing = $state(false);
	let initAttempts = $state(0);
	let rhinoReady = $state(false);
	const MAX_INIT_ATTEMPTS = 3;

	async function tryInitializeRhino() {
		initAttempts++;

		try {
			console.log(
				`Attempting to initialize Rhino (attempt ${initAttempts}/${MAX_INIT_ATTEMPTS})...`
			);

			// Set a timeout for initialization
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error('Rhino initialization timed out after 30 seconds')),
					30000
				)
			);

			await Promise.race([initializeRhino(COMPUTE_URL, DEFAULT_API_KEY), timeoutPromise]);

			// Verify that Rhino actually loaded
			const rhino = getRhino();
			if (!rhino) {
				throw new Error('Rhino initialized but getRhino() returned null');
			}

			console.log('Rhino initialized successfully');
			rhinoReady = true;
			loading = false;
			error = null;
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			console.error('Rhino initialization error:', errorMessage);

			if (initAttempts < MAX_INIT_ATTEMPTS) {
				console.log(`Retrying in 2 seconds...`);
				error = `Loading attempt ${initAttempts} failed. Retrying...`;
				await new Promise((resolve) => setTimeout(resolve, 2000));
				await tryInitializeRhino();
			} else {
				error = `Failed to load rhino3dm after ${MAX_INIT_ATTEMPTS} attempts: ${errorMessage}`;
				loading = false;
			}
		}
	}

	onMount(async () => {
		await tryInitializeRhino();
	});

	async function runTest(testFn: (rhino: any) => Promise<TestResult>) {
		const rhino = getRhino();

		if (!rhino) {
			error = 'Rhino is not initialized. Please refresh the page.';
			return;
		}

		executing = true;
		error = null;
		output = null;

		try {
			output = await testFn(rhino);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			console.error('Test execution error:', error);
		} finally {
			executing = false;
		}
	}

	function retryInitialization() {
		loading = true;
		error = null;
		rhinoReady = false;
		initAttempts = 0;
		tryInitializeRhino();
	}
</script>

<div
	class="bg-linear-to-b min-h-screen from-slate-50 to-white p-8 dark:from-slate-900 dark:to-slate-800"
>
	<div class="mx-auto max-w-5xl">
		<header class="mb-12">
			<h1 class="mb-2 text-4xl font-bold text-slate-900 dark:text-white">Compute Playground</h1>
			<p class="text-slate-600 dark:text-slate-400">
				Test different Rhino.Compute functions and explore the API
			</p>
		</header>

		<StatusBanner {loading} ready={rhinoReady} error={!!error} serverUrl={RhinoCompute.url} />

		{#if error && !loading}
			<div class="mb-6">
				<button
					onclick={retryInitialization}
					class="rounded-lg bg-sky-600 px-4 py-2 text-white transition-colors hover:bg-sky-700"
				>
					Retry Initialization
				</button>
			</div>
		{/if}

		<!-- Test Functions Grid -->
		<div class="mb-8">
			<h2 class="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Test Functions</h2>
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each computeTests as test}
					<TestButton
						name={test.name}
						description={test.description}
						disabled={!rhinoReady || executing || loading}
						onclick={() => runTest(test.fn)}
					/>
				{/each}
			</div>
		</div>

		<ResultDisplay result={output} {error} {executing} />

		<footer class="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
			<a href="./" class="text-sm text-sky-600 hover:underline"> ← Back to home </a>
		</footer>
	</div>
</div>
