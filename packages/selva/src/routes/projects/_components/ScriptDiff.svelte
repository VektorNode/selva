<script lang="ts">
	import type { LineOp } from '@selvajs/schemas';
	import { LoaderCircle } from '@lucide/svelte';

	interface Props {
		definitionGuid: string;
		versionId: string;
		scriptId: string;
		/** The version compared with; omitted = the version before. */
		against?: string;
	}

	let { definitionGuid, versionId, scriptId, against }: Props = $props();

	/** Unchanged lines kept around each change. */
	const CONTEXT = 3;

	type Row = LineOp | { op: 'gap'; count: number };

	let state = $state<
		{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'done'; rows: Row[] }
	>({ kind: 'loading' });

	$effect(() => {
		const url = `/api/v1/definitions/${definitionGuid}/versions/${versionId}/scripts/${scriptId}${against ? `?against=${against}` : ''}`;
		let cancelled = false;
		state = { kind: 'loading' };
		fetch(url)
			.then(async (res) => {
				const body = await res.json().catch(() => ({}));
				if (cancelled) return;
				state = res.ok
					? { kind: 'done', rows: collapse(body.lines as LineOp[]) }
					: { kind: 'error', message: body.message || `Failed to load (${res.status})` };
			})
			.catch(() => {
				if (!cancelled) state = { kind: 'error', message: 'Could not reach the server.' };
			});
		return () => {
			cancelled = true;
		};
	});

	function collapse(lines: LineOp[]): Row[] {
		const near = lines.map((_, i) =>
			lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((l) => l.op !== 'same')
		);
		const rows: Row[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (near[i]) rows.push(lines[i]);
			else {
				const last = rows.at(-1);
				if (last?.op === 'gap') last.count++;
				else rows.push({ op: 'gap', count: 1 });
			}
		}
		return rows;
	}

	const TONE = {
		add: 'bg-success/10 text-success',
		remove: 'bg-destructive/10 text-destructive',
		same: 'text-muted-foreground'
	};
	const SIGN = { add: '+', remove: '−', same: ' ' };
</script>

{#if state.kind === 'loading'}
	<p class="text-muted-foreground flex items-center gap-2 text-xs">
		<LoaderCircle class="h-3.5 w-3.5 animate-spin" /> Reading both files through Compute…
	</p>
{:else if state.kind === 'error'}
	<p class="text-destructive text-xs">{state.message}</p>
{:else}
	<pre class="bg-card max-h-96 overflow-auto rounded-md border text-xs leading-5"><code
			>{#each state.rows as row, i (i)}{#if row.op === 'gap'}<span
						class="text-faint-foreground block px-2">⋯ {row.count} unchanged</span
					>{:else}<span class="block px-2 whitespace-pre {TONE[row.op]}"
						>{SIGN[row.op]} {row.text}</span
					>{/if}{/each}</code
		></pre>
{/if}
