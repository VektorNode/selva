<script lang="ts">
	import { CLOUD_STEPS, LOCAL_STEPS, LAYERS, type Mode } from '$lib/architecture';
	import Cloud from '@lucide/svelte/icons/cloud';
	import Plug from '@lucide/svelte/icons/plug';

	let mode = $state<Mode>('cloud');
	let expanded = $state<string | null>(null);

	const steps = $derived(mode === 'cloud' ? CLOUD_STEPS : LOCAL_STEPS);

	function toggle(id: string) {
		expanded = expanded === id ? null : id;
	}
</script>

<svelte:head>
	<title>Architecture — how a Selva solve flows</title>
	<meta
		name="description"
		content="Step by step: how a Selva solve flows from a browser input to rendered geometry, in both runtime modes."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl px-6 pt-16 pb-24">
	<!-- Intro -->
	<p class="text-primary text-sm font-semibold tracking-wide uppercase">Architecture</p>
	<h1 class="mt-2 text-4xl font-bold tracking-tight text-balance">
		How a solve flows through Selva
	</h1>
	<p class="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
		From a slider move to rendered geometry, step by step — every layer the request crosses, and
		what changes between the two runtime modes. Click any step to expand it.
	</p>

	<!-- Mode switcher -->
	<div class="mt-10 flex flex-wrap items-center gap-6">
		<div
			class="border-border bg-card inline-flex rounded-lg border p-1"
			role="tablist"
			aria-label="Runtime mode"
		>
			<button
				role="tab"
				aria-selected={mode === 'cloud'}
				class="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition
					{mode === 'cloud'
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					mode = 'cloud';
					expanded = null;
				}}
			>
				<Cloud class="size-4" /> Cloud mode
			</button>
			<button
				role="tab"
				aria-selected={mode === 'local'}
				class="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition
					{mode === 'local'
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					mode = 'local';
					expanded = null;
				}}
			>
				<Plug class="size-4" /> Local mode
			</button>
		</div>
	</div>

	<p class="text-muted-foreground mt-4 text-sm leading-relaxed">
		{#if mode === 'cloud'}
			The deployed app: the browser talks to the Selva server, which solves through
			<span class="font-mono text-xs">Rhino.Compute</span>. The server reads records and blobs
			through provider interfaces, so the flow is the same whether they are backed by Postgres or by
			files on disk.
		{:else}
			The plugin preview: the browser talks straight to Grasshopper over one WebSocket. No server,
			no auth, no database — the definition is already open in Rhino.
		{/if}
	</p>

	<!-- Badge legend — the two kinds of thing that interrupt the straight path. -->
	<div class="text-muted-foreground mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
		<span class="flex items-center gap-1.5">
			<span class="size-2 rounded-full bg-amber-500" aria-hidden="true"></span>
			limits when work runs, stores nothing
		</span>
		<span class="flex items-center gap-1.5">
			<span class="size-2 rounded-full bg-violet-500" aria-hidden="true"></span>
			a cache — a hit skips what follows
		</span>
	</div>

	<!-- Step-by-step walkthrough -->
	<div class="relative mt-8">
		<!-- Spine -->
		<div class="bg-border absolute top-2 bottom-2 left-[7px] w-px" aria-hidden="true"></div>
		<div
			class="pulse-dot bg-primary absolute left-[3px] size-[9px] rounded-full motion-reduce:hidden"
			aria-hidden="true"
		></div>

		<ol class="space-y-3">
			{#each steps as step, i (step.id)}
				{@const layer = LAYERS[step.layer]}
				{@const prevLayer = i > 0 ? steps[i - 1].layer : null}
				{#if step.layer !== prevLayer}
					<li class="flex items-center gap-3 pt-6 pl-8 first:pt-0">
						<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold {layer.chip}"
							>{layer.label}</span
						>
						<span class="text-muted-foreground text-xs">{layer.sub}</span>
					</li>
				{/if}
				<li id="step-{step.id}" class="relative scroll-mt-24 pl-8">
					<!-- Node dot on the spine -->
					<span
						class="absolute top-4 left-[3px] size-[9px] rounded-full ring-4 {layer.dot} ring-background"
						aria-hidden="true"
					></span>
					<div class="border-border bg-card overflow-hidden rounded-lg border">
						<button
							class="hover:bg-muted/50 block w-full px-4 py-3.5 text-left transition"
							aria-expanded={expanded === step.id}
							onclick={() => toggle(step.id)}
						>
							<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<span class="text-muted-foreground text-xs tabular-nums">{i + 1}</span>
								<span class="font-semibold">{step.title}</span>
								{#if step.gates}
									{#each step.gates as gate (gate)}
										<span
											class="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400"
											>{gate}</span
										>
									{/each}
								{/if}
							</div>
							<p class="text-muted-foreground mt-1 pl-5 text-sm leading-relaxed">
								{step.oneliner}
							</p>
							{#if step.caches}
								<div class="mt-2 flex flex-wrap gap-1.5 pl-5">
									{#each step.caches as cache (cache.label)}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-400"
										>
											<span class="size-1.5 rounded-full bg-violet-500" aria-hidden="true"></span>
											{cache.label}<span class="opacity-70"> · {cache.hit}</span>
										</span>
									{/each}
								</div>
							{/if}
						</button>
						{#if expanded === step.id}
							<div class="border-border border-t px-4 py-3">
								<p class="text-muted-foreground text-sm leading-relaxed">{step.detail}</p>
								<div class="mt-3 flex flex-wrap gap-2">
									{#each step.files as file (file)}
										<code class="bg-muted text-muted-foreground rounded px-2 py-0.5 text-[11px]"
											>{file}</code
										>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	</div>
</div>

<style>
	@keyframes flow {
		0% {
			top: 1%;
			opacity: 0;
		}
		6% {
			opacity: 1;
		}
		94% {
			opacity: 1;
		}
		100% {
			top: 98%;
			opacity: 0;
		}
	}
	.pulse-dot {
		animation: flow 7s linear infinite;
	}
</style>
