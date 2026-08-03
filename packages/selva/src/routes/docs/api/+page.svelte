<script lang="ts">
	import { PageContent } from '@selvajs/ui';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Tailwind resolves class names statically, so the colour per method has to
	// be a full literal — an interpolated `text-${x}-600` compiles to nothing.
	const METHOD_CLASS: Record<string, string> = {
		GET: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
		POST: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
		PUT: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
		PATCH: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
		DELETE: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
	};
</script>

<svelte:head>
	<title>API reference</title>
	<meta name="description" content="The Selva HTTP API — endpoints, pagination, and errors." />
</svelte:head>

<PageContent class="mx-auto max-w-4xl">
	<header class="mb-10">
		<h1 class="text-3xl font-semibold tracking-tight">API reference</h1>
		<p class="text-muted-foreground mt-3 leading-relaxed">
			Every endpoint below acts as the calling identity and is confined to that identity's
			organization. Authenticate with a browser session cookie or a bearer token; the full
			machine-readable description is at
			<!-- A document to fetch, not a route to navigate to: `data-sveltekit-reload`
			     hands it to the browser instead of the client router, which would
			     otherwise try to render a page for it. -->
			<a
				class="underline underline-offset-4"
				href={resolve('/docs/api/openapi.yaml')}
				data-sveltekit-reload>/docs/api/openapi.yaml</a
			>.
		</p>
	</header>

	<section class="mb-10 grid gap-4 sm:grid-cols-2">
		<div class="bg-muted/40 rounded-lg border p-4">
			<h2 class="font-medium">Pagination</h2>
			<p class="text-muted-foreground mt-2 text-sm leading-relaxed">
				Lists take <code>limit</code> and <code>cursor</code> and return
				<code>{'{ items, nextCursor? }'}</code>. <code>nextCursor</code> is absent on the last page.
				Cursors are opaque — pass one back, never construct one. Default limit
				{data.pagination.defaultLimit}, maximum {data.pagination.maxLimit}; out-of-range values
				clamp rather than fail.
			</p>
		</div>
		<div class="bg-muted/40 rounded-lg border p-4">
			<h2 class="font-medium">Errors</h2>
			<p class="text-muted-foreground mt-2 text-sm leading-relaxed">
				Failures return <code>{'{ message, code }'}</code>. Branch on <code>code</code>, never on
				the human-readable message. A resource you cannot see returns <code>404</code>, not
				<code>403</code>.
			</p>
			<div class="mt-3 flex flex-wrap gap-1.5">
				{#each data.errorCodes as code (code)}
					<code class="bg-background rounded border px-1.5 py-0.5 text-xs">{code}</code>
				{/each}
			</div>
		</div>
	</section>

	{#each data.groups as group (group.tag)}
		<section class="mb-10">
			<h2 class="mb-4 border-b pb-2 text-xl font-semibold tracking-tight">{group.tag}</h2>

			<ul class="space-y-3">
				{#each group.endpoints as ep (ep.method + ep.path)}
					<li class="rounded-lg border p-4">
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<span
								class="rounded px-2 py-0.5 font-mono text-xs font-semibold {METHOD_CLASS[
									ep.method
								]}"
							>
								{ep.method}
							</span>
							<code class="text-sm font-medium break-all">{ep.path}</code>
						</div>

						<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{ep.summary}</p>

						<div class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
							{#if ep.paginated}
								<span>Paginated</span>
							{/if}
							{#if ep.hasBody}
								<span>JSON body</span>
							{/if}
							{#if ep.multipart}
								<span>
									multipart/form-data:
									{#each ep.multipart as f, i (f.field)}<code>{f.field}{f.required ? '' : '?'}</code
										>{i < ep.multipart.length - 1 ? ', ' : ''}{/each}
								</span>
							{/if}
							{#each ep.query as q (q.name)}
								<span><code>?{q.name}</code> — {q.description}</span>
							{/each}
							<span>Errors: {ep.errors.join(', ')}</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</PageContent>
