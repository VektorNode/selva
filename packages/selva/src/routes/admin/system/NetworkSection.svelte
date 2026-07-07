<script lang="ts">
	import { Button, Card } from '@selvajs/ui';
	import { ArrowDown, ArrowUp, Gauge } from '@lucide/svelte';

	interface RunResult {
		direction: 'download' | 'upload';
		mb: number;
		ms: number;
		mbps: number;
		/** Upload only: the server's own receive-side measurement. */
		serverMbps?: number | null;
		at: string;
	}

	const SIZES = [10, 25, 50, 100, 200] as const;
	let sizeMb = $state<number>(25);
	let running = $state<'download' | 'upload' | null>(null);
	let error = $state<string | null>(null);
	let results = $state<RunResult[]>([]);

	function record(result: RunResult) {
		results = [result, ...results].slice(0, 8);
	}

	// Incompressible payload so proxy compression can't fake a fast upload.
	// crypto.getRandomValues caps at 64 KiB per call, so fill in slices. Returns
	// the raw ArrayBuffer — a directly valid fetch BodyInit.
	function randomBytes(totalBytes: number): ArrayBuffer {
		const buffer = new ArrayBuffer(totalBytes);
		const view = new Uint8Array(buffer);
		const step = 65536;
		for (let offset = 0; offset < totalBytes; offset += step) {
			crypto.getRandomValues(view.subarray(offset, Math.min(offset + step, totalBytes)));
		}
		return buffer;
	}

	async function runDownload() {
		running = 'download';
		error = null;
		try {
			const start = performance.now();
			const res = await fetch(`/admin/api/system/throughput?mb=${sizeMb}`, {
				cache: 'no-store'
			});
			if (!res.ok || !res.body) {
				error = `Download test failed (HTTP ${res.status}).`;
				return;
			}
			// Stream-read so we measure arrival, not a buffered copy at the end.
			const reader = res.body.getReader();
			let bytes = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
			}
			const ms = performance.now() - start;
			record({
				direction: 'download',
				mb: bytes / (1024 * 1024),
				ms: Math.round(ms),
				mbps: bytes / (1024 * 1024) / (ms / 1000),
				at: new Date().toLocaleTimeString()
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Download test failed.';
		} finally {
			running = null;
		}
	}

	async function runUpload() {
		running = 'upload';
		error = null;
		try {
			const body = randomBytes(sizeMb * 1024 * 1024);
			const start = performance.now();
			const res = await fetch('/admin/api/system/throughput', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body
			});
			const ms = performance.now() - start;
			if (!res.ok) {
				error =
					res.status === 413
						? `Upload rejected (HTTP 413) — a body-size limit in the chain is below ${sizeMb} MB ` +
							`(adapter-node BODY_SIZE_LIMIT, or a proxy request cap).`
						: `Upload test failed (HTTP ${res.status}).`;
				return;
			}
			const server = (await res.json()) as { mbps: number | null };
			record({
				direction: 'upload',
				mb: sizeMb,
				ms: Math.round(ms),
				mbps: sizeMb / (ms / 1000),
				serverMbps: server.mbps,
				at: new Date().toLocaleTimeString()
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Upload test failed.';
		} finally {
			running = null;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-sm font-medium">Network throughput</Card.Title>
		<Card.Description>
			Transfers incompressible random data between this browser and the server — through every
			proxy/tunnel on the path — to measure real transport speed in each direction. No compute
			involvement; large solve transfers can't go faster than these numbers.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<div class="flex flex-wrap items-center gap-2">
			<label class="text-muted-foreground text-sm" for="throughput-size">Test size</label>
			<select
				id="throughput-size"
				class="border-input bg-background rounded-md border px-2 py-1 text-sm"
				bind:value={sizeMb}
				disabled={running !== null}
			>
				{#each SIZES as size (size)}
					<option value={size}>{size} MB</option>
				{/each}
			</select>
			<Button size="sm" variant="outline" onclick={runDownload} disabled={running !== null}>
				<ArrowDown class="mr-1 size-4" />
				{running === 'download' ? 'Downloading…' : 'Download test'}
			</Button>
			<Button size="sm" variant="outline" onclick={runUpload} disabled={running !== null}>
				<ArrowUp class="mr-1 size-4" />
				{running === 'upload' ? 'Uploading…' : 'Upload test'}
			</Button>
		</div>

		{#if error}
			<p class="text-destructive text-sm">{error}</p>
		{/if}

		{#if results.length > 0}
			<ul class="space-y-1">
				{#each results as r (r.at + r.direction + r.ms)}
					<li class="flex items-center gap-2 font-mono text-sm">
						<Gauge class="text-muted-foreground size-4" />
						<span class="text-muted-foreground">{r.at}</span>
						<span>{r.direction === 'download' ? '↓' : '↑'} {r.mb.toFixed(0)} MB</span>
						<span class="font-semibold">{r.mbps.toFixed(1)} MB/s</span>
						<span class="text-muted-foreground">({(r.ms / 1000).toFixed(1)}s)</span>
						{#if r.serverMbps != null}
							<span class="text-muted-foreground">· server-side {r.serverMbps.toFixed(1)} MB/s</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
