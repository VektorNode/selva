<script lang="ts">
	// What the running solve has said so far, with a way to stop it. Shows while a solve is in
	// flight and has raised at least one diagnostic, then lingers briefly after it ends — most
	// solves finish in well under a second, so without the linger nothing would ever be seen.
	// Yields to the end-of-solve dialog, which handles anything that needs an answer.

	import { CircleAlert, TriangleAlert, Info } from '@lucide/svelte';
	import type { SolveEvent } from '@selvajs/schemas';
	import { Button } from '$lib/components/primitives/button';

	interface Props {
		events: SolveEvent[];
		solving: boolean;
		/** The acknowledgement dialog is open; it owns the screen. */
		dialogOpen?: boolean;
		onabort: () => void;
		abortLabel: string;
	}

	let { events, solving, dialogOpen = false, onabort, abortLabel }: Props = $props();

	const LINGER_MS = 6000;

	interface Diagnostic {
		level?: string;
		message?: string;
		source?: string;
	}

	const diagnostics = $derived(
		events.filter((e) => e.type === 'diagnostic' && e.payload).map((e) => e.payload as Diagnostic)
	);

	let lingering = $state(false);
	$effect(() => {
		if (solving) {
			lingering = false;
			return;
		}
		if (diagnostics.length === 0) return;
		lingering = true;
		const timer = setTimeout(() => (lingering = false), LINGER_MS);
		return () => clearTimeout(timer);
	});

	const visible = $derived(!dialogOpen && diagnostics.length > 0 && (solving || lingering));
</script>

{#if visible}
	<div
		class="bottom-4 p-3 shadow-lg fixed left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border bg-background"
		role="status"
		data-testid="solve-live-banner"
	>
		<ul class="max-h-40 space-y-1.5 text-sm overflow-y-auto">
			{#each diagnostics as d, i (i)}
				<li class="gap-2 flex">
					{#if d.level === 'error'}
						<CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
					{:else if d.level === 'warning'}
						<TriangleAlert class="mt-0.5 h-4 w-4 text-amber-500 shrink-0" />
					{:else}
						<Info class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					{/if}
					<span class="flex-1">
						{#if d.source}<span class="font-medium">{d.source}:</span>{/if}
						{d.message}
					</span>
				</li>
			{/each}
		</ul>
		{#if solving}
			<div class="mt-2 flex justify-end">
				<Button variant="outline" size="sm" onclick={onabort}>{abortLabel}</Button>
			</div>
		{/if}
	</div>
{/if}
