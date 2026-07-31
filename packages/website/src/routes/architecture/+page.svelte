<script lang="ts">
	import {
		CLOUD_STEPS,
		LOCAL_STEPS,
		CACHES,
		FLOW_CONTROLS,
		LAYERS,
		SERVER_TIMING,
		type FlowStep,
		type Mode,
		type Provider,
		type Layer
	} from '$lib/architecture';
	import Cloud from '@lucide/svelte/icons/cloud';
	import Plug from '@lucide/svelte/icons/plug';
	import Database from '@lucide/svelte/icons/database';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import SolveFlowDiagram from '$lib/components/SolveFlowDiagram.svelte';
	import SolveFlowOverview from '$lib/components/SolveFlowOverview.svelte';

	let mode = $state<Mode>('cloud');
	let provider = $state<Provider>('supabase');
	/** 'overview' = the 10-second map; 'detail' = the full reference graph. */
	let view = $state<'overview' | 'detail'>('overview');
	let expanded = $state<string | null>(null);

	/** A diagram-node click expands the matching step card and scrolls to it. */
	function selectFromDiagram(id: string | null) {
		expanded = id;
		if (id) {
			// Wait a tick so the card's expansion is in the DOM before scrolling.
			requestAnimationFrame(() => {
				document
					.getElementById(`step-${id}`)
					?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			});
		}
	}

	const steps = $derived(mode === 'cloud' ? CLOUD_STEPS : LOCAL_STEPS);

	/** Apply the provider variant (cloud mode only) on top of a step. */
	function resolved(step: FlowStep): FlowStep {
		if (mode !== 'cloud' || !step.variants) return step;
		const v = step.variants[provider];
		return v ? { ...step, ...v } : step;
	}

	function toggle(id: string) {
		expanded = expanded === id ? null : id;
	}

	/** Cache entries relevant to the current mode, grouped for the table. */
	const visibleCaches = $derived(
		mode === 'cloud' ? CACHES : CACHES.filter((c) => c.layer === 'browser')
	);

	const scopeLabel: Record<string, string> = {
		'per-tab': 'browser tab',
		'per-process': 'Selva server process',
		'db-shared': 'database — shared',
		'vm-shared': 'compute VM — shared'
	};

	function layerInfo(layer: Layer | 'rhino-shared') {
		return LAYERS[layer === 'rhino-shared' ? 'rhino' : layer];
	}

	function cacheById(id: string) {
		return CACHES.find((c) => c.id === id);
	}
</script>

<svelte:head>
	<title>Architecture — how a Selva solve flows</title>
	<meta
		name="description"
		content="The end-to-end Selva solve flow: every layer, every cache, and how the two runtime modes and providers change the picture."
	/>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 pt-16 pb-24">
	<!-- Intro -->
	<p class="text-primary text-sm font-semibold tracking-wide uppercase">Architecture</p>
	<h1 class="mt-2 text-4xl font-bold tracking-tight text-balance">
		How a solve flows through Selva
	</h1>
	<p class="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
		From a slider move to rendered geometry — every layer the request crosses, every cache it can
		hit, and what changes between the two runtime modes. Click any step for the plain-language
		version.
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

		{#if mode === 'cloud' && view === 'detail'}
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
					>Provider</span
				>
				<div
					class="border-border bg-card inline-flex rounded-lg border p-1"
					role="tablist"
					aria-label="Data provider"
				>
					<button
						role="tab"
						aria-selected={provider === 'localfs'}
						class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition
							{provider === 'localfs'
							? 'bg-muted text-foreground font-medium'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => (provider = 'localfs')}
					>
						<HardDrive class="size-3.5" /> Local files
					</button>
					<button
						role="tab"
						aria-selected={provider === 'supabase'}
						class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition
							{provider === 'supabase'
							? 'bg-muted text-foreground font-medium'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => (provider = 'supabase')}
					>
						<Database class="size-3.5" /> Supabase
					</button>
				</div>
			</div>
		{/if}
	</div>

	<p class="text-muted-foreground mt-4 text-sm leading-relaxed">
		{#if mode === 'cloud'}
			The deployed app: the browser talks to the Selva server, which solves through
			<span class="font-mono text-xs">Rhino.Compute</span>.
			{#if provider === 'supabase'}
				Data and blobs live in Postgres under row-level security.
			{:else}
				Data and blobs are JSON files and blobs on the server’s disk — no database.
			{/if}
		{:else}
			The plugin preview: the browser talks straight to Grasshopper over one WebSocket. No server,
			no auth, no database, no compute caches — the definition is already open in Rhino.
		{/if}
	</p>

	<!-- Overview / Detail toggle — Overview is the 10-second map; Detail is the
	     full reference graph (every call, cache lifetime, and gap). -->
	<div class="mt-8 flex flex-wrap items-center gap-3">
		<div
			class="border-border bg-card inline-flex rounded-lg border p-1"
			role="tablist"
			aria-label="Diagram detail"
		>
			<button
				role="tab"
				aria-selected={view === 'overview'}
				class="rounded-md px-4 py-1.5 text-sm font-medium transition
					{view === 'overview'
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (view = 'overview')}
			>
				Overview
			</button>
			<button
				role="tab"
				aria-selected={view === 'detail'}
				class="rounded-md px-4 py-1.5 text-sm font-medium transition
					{view === 'detail'
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (view = 'detail')}
			>
				Detail
			</button>
		</div>
		<span class="text-muted-foreground text-sm">
			{view === 'overview'
				? 'The shape in six boxes — the cache hit/miss fork is the whole story.'
				: 'Every backend call, cache lifetime, and known gap. Click a node to jump to its explanation.'}
		</span>
	</div>

	<!-- Diagram — full-bleed: escape the max-w-4xl text column and span the
	     viewport. Overview centers a compact canvas; Detail spans wide. -->
	<div class="relative left-1/2 mt-6 ml-[-50vw] w-screen">
		<div class="mx-auto max-w-[1640px] px-4 sm:px-6">
			{#if view === 'overview'}
				<SolveFlowOverview {mode} />
			{:else}
				<SolveFlowDiagram {mode} {provider} selected={expanded} onselect={selectFromDiagram} />
			{/if}
		</div>
	</div>

	{#if mode === 'cloud'}
		<!-- Scaling note: the in-process caches are per-instance; ISolveResultCache is
		     the pluggable seam where a shared store (Redis) drops in. -->
		<aside
			class="border-border bg-muted/40 mt-8 rounded-lg border border-l-2 border-l-cyan-500/60 p-4"
		>
			<div class="flex items-center gap-2">
				<span class="text-sm font-semibold">Scaling note — a shared cache (e.g. Redis)</span>
				<span
					class="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-600 dark:text-cyan-400"
				>
					seam built · shared backend not yet
				</span>
			</div>
			<p class="text-muted-foreground mt-2 text-sm leading-relaxed">
				Most of the server-side caches — the
				<a href="#cache-sched-response" class="text-violet-600 hover:underline dark:text-violet-400"
					>response cache</a
				>
				and
				<a href="#cache-pointer-map" class="text-violet-600 hover:underline dark:text-violet-400"
					>pointer map</a
				>
				inside <span class="font-mono text-xs">@selvajs/compute</span>, plus the
				<a href="#cache-def-bytes" class="text-violet-600 hover:underline dark:text-violet-400"
					>definition-byte cache</a
				>
				— live in one server instance’s memory, so each instance has its own copy. Run several instances
				behind a load balancer and a solve cached on instance A is a miss on instance B. The pluggable
				<span class="font-mono text-xs">ISolveResultCache</span>
				seam exists for fixing exactly this: no backend ships today, and a shared one like Redis would
				drop in behind the interface so the whole fleet reads and writes one cache — no change to the
				browser or the compute VM. The VM-side caches (<span class="whitespace-nowrap"
					>definition cache</span
				>,
				<span class="font-mono text-xs">cachesolve</span>) are already shared server-side, so
				they’re unaffected.
			</p>
		</aside>
	{/if}

	<!-- Step-by-step walkthrough -->
	<h2 class="mt-16 text-2xl font-bold tracking-tight">Step by step</h2>
	<div class="relative mt-6">
		<!-- Spine -->
		<div class="bg-border absolute top-2 bottom-2 left-[7px] w-px" aria-hidden="true"></div>
		<div
			class="pulse-dot bg-primary absolute left-[3px] size-[9px] rounded-full motion-reduce:hidden"
			aria-hidden="true"
		></div>

		<ol class="space-y-3">
			{#each steps as raw, i (raw.id)}
				{@const step = resolved(raw)}
				{@const layer = LAYERS[step.layer]}
				{@const prevLayer = i > 0 ? steps[i - 1].layer : null}
				{#if step.layer !== prevLayer}
					<li class="flex items-center gap-3 pt-4 pl-8 first:pt-0">
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
							class="hover:bg-muted/50 block w-full px-4 py-3 text-left transition"
							aria-expanded={expanded === step.id}
							onclick={() => toggle(step.id)}
						>
							<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
							<p class="text-muted-foreground mt-1 text-sm leading-relaxed">{step.oneliner}</p>
							{#if step.calls}
								<ol class="mt-2 space-y-1">
									{#each step.calls as call, i (call.name)}
										<li class="flex flex-wrap items-center gap-1.5 text-[12px]">
											<span class="text-muted-foreground tabular-nums">{i + 1}.</span>
											<code
												class="rounded border px-1.5 py-0.5 {call.kind === 'storage'
													? 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300'
													: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'}"
												>{call.name}</code
											>
											<span class="text-muted-foreground">→ {call.target}</span>
											<span
												class="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase {call.cached ===
												'uncached'
													? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
													: 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}"
												>{call.cached}</span
											>
										</li>
									{/each}
								</ol>
							{/if}
							{#if step.gap}
								<p
									class="mt-2 rounded border border-dashed border-amber-500/40 bg-amber-500/6 px-3 py-2 text-[13px] leading-relaxed text-amber-700 dark:text-amber-300"
								>
									<span class="font-semibold">Optimization gap — </span>{step.gap}
								</p>
							{/if}
							{#if step.caches}
								<div class="mt-2 flex flex-wrap gap-1.5">
									{#each step.caches as ref (ref.id)}
										{@const c = cacheById(ref.id)}
										{#if c}
											<span
												class="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-400"
											>
												<span class="size-1.5 rounded-full bg-violet-500" aria-hidden="true"></span>
												{c.name}<span class="opacity-70"> · {c.lifetime}</span>
											</span>
										{/if}
									{/each}
								</div>
							{/if}
						</button>
						{#if expanded === step.id}
							<div class="border-border border-t px-4 py-3">
								<p class="text-muted-foreground text-sm leading-relaxed">{step.detail}</p>
								{#if step.caches}
									<ul class="mt-3 space-y-1">
										{#each step.caches as ref (ref.id)}
											{@const c = cacheById(ref.id)}
											{#if c}
												<li class="text-sm">
													<a
														href="#cache-{c.id}"
														class="text-violet-600 hover:underline dark:text-violet-400">{c.name}</a
													>
													<span class="text-muted-foreground"> — {ref.note}</span>
												</li>
											{/if}
										{/each}
									</ul>
								{/if}
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

	<!-- Valves, not memory -->
	<section class="mt-20">
		<h2 class="text-2xl font-bold tracking-tight">Looks like a cache, isn’t one</h2>
		<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
			Four mechanisms limit <em>how often</em> things run but remember no results. When you ask “why didn’t
			this request fire?”, it’s one of these — not a cache.
		</p>
		<div class="mt-6 grid gap-4 sm:grid-cols-2">
			{#each FLOW_CONTROLS as ctrl (ctrl.name)}
				<div class="border-border bg-card rounded-lg border p-4">
					<div class="flex items-center gap-2">
						<span class="size-2 rounded-full bg-amber-500" aria-hidden="true"></span>
						<span class="font-semibold">{ctrl.name}</span>
						<span class="text-muted-foreground ml-auto text-xs">{ctrl.where}</span>
					</div>
					<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{ctrl.what}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- Cache inventory -->
	<section class="mt-20">
		<h2 class="text-2xl font-bold tracking-tight">Every cache, in one table</h2>
		<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
			{#if mode === 'cloud'}
				Twelve caches sit on the cloud solve path — three in the browser, five in the Selva server,
				two in the compute client, two on the compute VM itself.
			{:else}
				Local mode keeps the three browser-side caches — the client solve memo plus the two viewer
				caches; everything else belongs to the cloud path.
			{/if}
		</p>
		<div class="border-border mt-6 overflow-x-auto rounded-lg border">
			<table class="w-full min-w-[64rem] text-sm">
				<thead>
					<tr class="border-border bg-muted/50 border-b text-left">
						<th class="px-4 py-3 font-semibold">Cache</th>
						<th class="px-4 py-3 font-semibold">What it remembers</th>
						<th class="px-4 py-3 font-semibold">Keyed by</th>
						<th class="px-4 py-3 font-semibold">Lifetime</th>
						<th class="px-4 py-3 font-semibold">Cleared by</th>
					</tr>
				</thead>
				<tbody>
					{#each visibleCaches as cache (cache.id)}
						{@const layer = layerInfo(cache.layer)}
						<tr
							id="cache-{cache.id}"
							class="border-border scroll-mt-24 border-b align-top last:border-b-0"
						>
							<td class="px-4 py-3">
								<div class="flex items-center gap-2 font-medium whitespace-nowrap">
									<span class="size-2 shrink-0 rounded-full {layer.dot}" aria-hidden="true"></span>
									{cache.name}
								</div>
								<div class="text-muted-foreground mt-1 text-xs">{scopeLabel[cache.scope]}</div>
							</td>
							<td class="text-muted-foreground min-w-[16rem] px-4 py-3 leading-relaxed"
								>{cache.what}</td
							>
							<td class="text-muted-foreground px-4 py-3 font-mono text-xs leading-relaxed"
								>{cache.keyedBy}</td
							>
							<td
								class="text-muted-foreground px-4 py-3 text-xs leading-relaxed"
								style="font-variant-numeric: tabular-nums">{cache.policy}</td
							>
							<td class="text-muted-foreground px-4 py-3 text-xs leading-relaxed"
								>{cache.invalidation}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Server-Timing legend -->
	{#if mode === 'cloud'}
		<section class="mt-20">
			<h2 class="text-2xl font-bold tracking-tight">Watching the caches live</h2>
			<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
				Every solve response carries a <code class="bg-muted rounded px-1.5 py-0.5 text-xs"
					>Server-Timing</code
				>
				header — open devtools → Network → the compute request → Timing, and read exactly where the time
				went and which caches hit.
			</p>
			<div
				class="border-border bg-card mt-6 divide-y divide-[color:var(--color-border)] rounded-lg border"
			>
				{#each SERVER_TIMING as entry (entry.metric)}
					<div class="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
						<code class="text-primary shrink-0 font-mono text-xs sm:w-64">{entry.metric}</code>
						<span class="text-muted-foreground text-sm">{entry.meaning}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
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
