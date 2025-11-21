<script lang="ts">
	import {
		fetchDefinitionIO,
		fetchParsedDefinitionIO,
		GrasshopperResponseProcessor,
		inputsToDataTrees,
		solveGrasshopperDefinition
	} from 'rhino-compute-core/grasshopper';
	import { fetchRhinoCompute } from 'rhino-compute-core/core';
	import { onMount } from 'svelte';
	import type {
		BufferGeometry,
		BufferGeometryEventMap,
		Material,
		Mesh,
		NormalBufferAttributes,
		Object3DEventMap
	} from 'three';
	import type { FileData, GrasshopperComputeResponse } from 'rhino-compute-core';
	import { DEFAULT_CONFIG } from '$lib';
	import Button from '$lib/components/Ui/Button.svelte';
	let activeTab = $state<'result' | 'io'>('result');

	let definitionUrl = $state('http://localhost:5173/scripts/output_test.gh');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<GrasshopperComputeResponse | null>(null);
	let downloadName = $state('DefinitionFiles');
	let parsedData = $state<{
		printData: string[];
		meshes: Mesh<
			BufferGeometry<NormalBufferAttributes, BufferGeometryEventMap>,
			Material | Material[],
			Object3DEventMap
		>[];
		files: FileData[];
		paramNames: string[];
	} | null>(null);
	let rawIoResponse = $state<any>(null);

	async function runDefinition() {
		loading = true;
		error = null;
		result = null;
		parsedData = null;

		try {
			rawIoResponse = await fetchRhinoCompute<'io'>(
				'io',
				{ pointer: definitionUrl },
				DEFAULT_CONFIG
			);
			const inputs = await fetchParsedDefinitionIO(definitionUrl, DEFAULT_CONFIG);
			const tree = inputsToDataTrees(inputs.inputs);

			const computeResult = await solveGrasshopperDefinition(tree, definitionUrl, DEFAULT_CONFIG);

			const responseProcessor = new GrasshopperResponseProcessor(computeResult);

			parsedData = {
				printData: responseProcessor.getContextPrintData(),
				meshes: responseProcessor.getDisplayFromResponse(),
				files: responseProcessor.getFileData(),
				paramNames: responseProcessor.getParameterNames()
			};

			result = computeResult;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function handleDownloadFiles() {
		if (parsedData?.files.length) {
			const responseProcessor = new GrasshopperResponseProcessor(result!);
			responseProcessor.getAndDownloadFiles('DefinitionFiles');
		}
	}

	onMount(() => {
		runDefinition();
	});
</script>

<div class="bg-linear-to-br min-h-screen from-emerald-50 via-white to-sky-50 p-8">
	<div class="mx-auto max-w-7xl">
		<!-- Header -->
		<header class="mb-8">
			<h1 class="text-3xl font-bold text-slate-900">Grasshopper Playground</h1>
			<p class="mt-2 text-slate-600">Test and inspect Grasshopper definition outputs</p>
		</header>

		<!-- Controls -->
		<div class="mb-6 flex gap-4">
			<input
				type="text"
				bind:value={definitionUrl}
				placeholder="Definition URL"
				class="flex-1 rounded-lg border border-slate-300 px-4 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
			/>
			<Button onclick={runDefinition} disabled={loading}>
				{loading ? 'Running...' : 'Run Definition'}
			</Button>
		</div>

		<!-- Error Display -->
		{#if error}
			<div class="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
				<h3 class="mb-2 font-semibold text-red-900">Error</h3>
				<p class="text-sm text-red-700">{error}</p>
			</div>
		{/if}

		<!-- Results Grid -->
		{#if parsedData}
			<div class="grid gap-6 lg:grid-cols-2">
				<!-- Print Output -->
				<div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
						<svg
							class="h-5 w-5 text-emerald-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						Print Output ({parsedData.printData.length})
					</h3>
					<div class="space-y-2">
						{#each parsedData.printData as item, i}
							<div class="rounded bg-slate-50 p-3">
								<div class="text-xs font-medium text-slate-500">Output {i + 1}</div>
								<pre class="mt-1 overflow-x-auto text-sm text-slate-700">{JSON.stringify(
										item,
										null,
										2
									)}</pre>
							</div>
						{:else}
							<p class="text-sm text-slate-500">No print output</p>
						{/each}
					</div>
				</div>

				<!-- Mesh Output -->
				<div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
						<svg class="h-5 w-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
							/>
						</svg>
						Mesh Display ({parsedData.meshes.length})
					</h3>
					<div class="space-y-2">
						{#each parsedData.meshes as mesh, i}
							<div class="rounded bg-slate-50 p-3">
								<div class="text-xs font-medium text-slate-500">Mesh {i + 1}</div>
								<div class="mt-1 grid grid-cols-2 gap-2 text-sm">
									<div class="text-slate-600">
										<span class="font-medium">Vertices:</span>
										{mesh.geometry?.attributes?.position?.count ?? 'N/A'}
									</div>
									<div class="text-slate-600">
										<span class="font-medium">Faces:</span>
										{mesh.geometry?.index ? mesh.geometry.index.count / 3 : 'N/A'}
									</div>
								</div>
								<div class="mt-2 border-t border-slate-200 pt-2">
									<div class="mb-1 text-xs font-medium text-slate-500">Bounding Box Size</div>
									<div class="grid grid-cols-3 gap-2 text-xs">
										<div class="text-slate-600">
											<span class="font-medium">X:</span>
											{mesh.geometry?.boundingBox
												? (
														mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x
													).toFixed(2)
												: 'N/A'}
										</div>
										<div class="text-slate-600">
											<span class="font-medium">Y:</span>
											{mesh.geometry?.boundingBox
												? (
														mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y
													).toFixed(2)
												: 'N/A'}
										</div>
										<div class="text-slate-600">
											<span class="font-medium">Z:</span>
											{mesh.geometry?.boundingBox
												? (
														mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z
													).toFixed(2)
												: 'N/A'}
										</div>
									</div>
								</div>
							</div>
						{:else}
							<p class="text-sm text-slate-500">No meshes</p>
						{/each}
					</div>
				</div>

				<!-- Param Names List -->
				{#if parsedData?.paramNames?.length}
					<div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
						<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
							<svg
								class="h-5 w-5 text-indigo-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M3 7v4a1 1 0 001 1h3m10-5h3a1 1 0 011 1v4m-5 5l-4 4m0 0l-4-4m4 4V3"
								/>
							</svg>
							Parameter Names ({parsedData.paramNames.length})
						</h3>
						<ul class="list-disc space-y-1 pl-5 text-sm text-slate-700">
							{#each parsedData.paramNames as name}
								<li>{name}</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- File Output -->
				<div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
						<svg
							class="h-5 w-5 text-purple-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						File Data ({parsedData.files.length})
					</h3>
					<div class="space-y-2">
						{#each parsedData.files as file, i}
							<div class="rounded bg-slate-50 p-3">
								<div class="text-xs font-medium text-slate-500">File {i + 1}</div>
								<pre class="mt-1 overflow-x-auto text-sm text-slate-700">{JSON.stringify(
										file,
										null,
										2
									)}</pre>
							</div>
						{:else}
							<p class="text-sm text-slate-500">No files</p>
						{/each}
						{#if parsedData.files.length !== 0}
							<!-- Download Controls: place this inside your file output card, replacing your current .flex.gap-5 div -->
							<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
								<div class="flex-1">
									<label for="downloadName" class="mb-1 block text-xs font-medium text-slate-500">
										Download Name
									</label>
									<input
										id="downloadName"
										type="text"
										bind:value={downloadName}
										placeholder="Download Name"
										class="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
									/>
								</div>
								<Button onclick={handleDownloadFiles}>Download Files</Button>
							</div>
						{/if}
					</div>
				</div>

				<!-- Raw Result -->
				<div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<h3 class="flex items-center gap-2 text-lg font-semibold text-slate-900">
								<svg
									class="h-5 w-5 text-slate-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
									/>
								</svg>
								Raw Response
							</h3>
							<div class="flex gap-2 border-l border-slate-200 pl-4">
								<button
									onclick={() => {
										activeTab = 'result';
									}}
									class="rounded-lg px-3 py-1 text-sm font-medium transition"
									class:bg-emerald-100={activeTab === 'result'}
									class:text-emerald-700={activeTab === 'result'}
									class:text-slate-500={activeTab !== 'result'}
									class:hover:text-slate-700={activeTab !== 'result'}
								>
									Compute Response
								</button>
								<button
									onclick={() => {
										activeTab = 'io';
									}}
									class="rounded-lg px-3 py-1 text-sm font-medium transition"
									class:bg-emerald-100={activeTab === 'io'}
									class:text-emerald-700={activeTab === 'io'}
									class:text-slate-500={activeTab !== 'io'}
									class:hover:text-slate-700={activeTab !== 'io'}
								>
									IO Response
								</button>
							</div>
						</div>
						<button
							onclick={() => {
								const data = activeTab === 'result' ? result : rawIoResponse;
								navigator.clipboard.writeText(JSON.stringify(data, null, 2));
							}}
							class="rounded-lg bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
						>
							<svg
								class="mr-1 inline h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
								/>
							</svg>
							Copy
						</button>
					</div>
					<pre
						class="overflow-x-auto rounded bg-slate-900 p-4 text-sm text-emerald-400">{JSON.stringify(
							activeTab === 'result' ? result : rawIoResponse,
							null,
							2
						)}</pre>
				</div>
			</div>
		{/if}

		<!-- Loading State -->
		{#if loading}
			<div class="flex items-center justify-center py-12">
				<div
					class="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"
				></div>
				<span class="ml-3 text-slate-600">Processing definition...</span>
			</div>
		{/if}
	</div>
</div>
