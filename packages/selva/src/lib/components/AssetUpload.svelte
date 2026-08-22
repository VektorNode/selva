<script lang="ts">
	import { Button, Card, toast, ConfirmDialog } from '@selvajs/ui';
	import { ImageUp, Trash2, Building2 } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { OrgAssetKind } from '@selvajs/platform';

	interface Props {
		orgId: string;
		kind: OrgAssetKind;
		/** Current public URL for this asset, or null when unset. */
		url: string | null;
		title: string;
		description?: string;
	}

	let { orgId, kind, url, title, description }: Props = $props();

	// Accept raster + SVG. The server rasterizes everything (incl. SVG) to WebP,
	// so this list is UX only — the route re-validates the content type.
	const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
	// Mirror the server cap (MAX_IMAGE_FILE_SIZE default 10 MB) for instant feedback.
	const MAX_BYTES = 10 * 1024 * 1024;

	const endpoint = $derived(`/api/v1/orgs/${orgId}/assets/${kind}`);

	let fileInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false);
	let confirmingRemove = $state(false);

	async function onSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		if (!ACCEPT.split(',').includes(file.type)) {
			toast.error('Unsupported image type. Use PNG, JPG, WebP, GIF, or SVG.');
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error(`Image too large. Max ${MAX_BYTES / (1024 * 1024)} MB.`);
			return;
		}

		busy = true;
		try {
			const body = new FormData();
			body.append('image', file);
			const res = await fetch(endpoint, { method: 'POST', body });
			if (res.ok) {
				toast.success(`${title} updated`);
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || `Upload failed (${res.status})`);
			}
		} catch {
			toast.error('Failed to upload');
		} finally {
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		try {
			const res = await fetch(endpoint, { method: 'DELETE' });
			if (res.ok) {
				toast.success(`${title} removed`);
				confirmingRemove = false;
				await invalidateAll();
			} else {
				toast.error(`Remove failed (${res.status})`);
			}
		} catch {
			toast.error('Failed to remove');
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-sm font-medium">
			<Building2 class="text-muted-foreground h-4 w-4" />
			{title}
		</Card.Title>
		{#if description}
			<Card.Description>{description}</Card.Description>
		{/if}
	</Card.Header>
	<Card.Content>
		<div class="flex items-center gap-4">
			<div
				class="bg-muted/40 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
			>
				{#if url}
					<img src={url} alt={title} class="h-full w-full object-contain" />
				{:else}
					<Building2 class="text-muted-foreground/50 h-8 w-8" />
				{/if}
			</div>
			<div class="flex flex-col gap-2">
				<p class="text-muted-foreground text-xs">
					PNG, JPG, WebP, GIF, or SVG. Stored at up to 1200px as WebP.
				</p>
				<div class="flex gap-2">
					<input
						bind:this={fileInput}
						type="file"
						accept={ACCEPT}
						class="hidden"
						onchange={onSelect}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => fileInput?.click()}
						class="h-8"
					>
						<ImageUp class="mr-1.5 h-3.5 w-3.5" />
						{busy ? 'Working…' : url ? 'Replace' : 'Upload'}
					</Button>
					{#if url}
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onclick={() => (confirmingRemove = true)}
							class="text-destructive hover:text-destructive h-8"
						>
							<Trash2 class="mr-1.5 h-3.5 w-3.5" />
							Remove
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</Card.Content>
</Card.Root>

<ConfirmDialog
	bind:open={confirmingRemove}
	title={`Remove ${title}?`}
	confirmLabel="Remove"
	pendingLabel="Removing…"
	variant="destructive"
	onConfirm={remove}
/>
