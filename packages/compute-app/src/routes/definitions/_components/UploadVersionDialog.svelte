<script lang="ts">
	import { Button, Dialog, Label, Textarea, toast } from '@selvajs/shared';
	import { Upload, FileUp } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';

	interface Props {
		definitionGuid: string;
		nextVersionNumber: number;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onUploaded: () => void;
	}

	let { definitionGuid, nextVersionNumber, open, onOpenChange, onUploaded }: Props = $props();

	let fileInput = $state<HTMLInputElement>();
	let fileName = $state<string | null>(null);
	let changeNote = $state('');
	let uploading = $state(false);

	$effect(() => {
		if (!open) reset();
	});

	function reset() {
		fileName = null;
		changeNote = '';
		uploading = false;
		if (fileInput) fileInput.value = '';
	}

	function onFilePick() {
		fileName = fileInput?.files?.[0]?.name ?? null;
	}

	async function submit() {
		if (!fileInput?.files?.length) return;
		uploading = true;
		const formData = new FormData();
		formData.append('file', fileInput.files[0]);
		if (changeNote.trim()) formData.append('changeNote', changeNote.trim());
		try {
			const res = await fetch(`/api/definitions/${definitionGuid}`, {
				method: 'POST',
				body: formData
			});
			if (res.ok) {
				const result = await res.json();
				toast.success(`v${result.version?.versionNumber ?? nextVersionNumber} uploaded as draft`);
				onUploaded();
				await invalidateAll();
				onOpenChange(false);
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || e.error || 'Upload failed');
			}
		} catch {
			toast.error('Upload failed');
		} finally {
			uploading = false;
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Upload new version</Dialog.Title>
			<Dialog.Description>
				The upload becomes <strong>v{nextVersionNumber}</strong> as a draft. The live channel stays
				unchanged until you publish.
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-4 space-y-4">
			<div class="space-y-1.5">
				<Label for="upload-file">Grasshopper file</Label>
				<label
					for="upload-file"
					class="flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed border-border px-4 py-5 transition-colors hover:bg-accent/30"
				>
					<FileUp class="h-5 w-5 shrink-0 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						{#if fileName}
							<p class="truncate text-sm font-medium">{fileName}</p>
							<p class="text-xs text-muted-foreground">Click to choose a different file</p>
						{:else}
							<p class="text-sm font-medium">Pick a .gh or .ghx file</p>
							<p class="text-xs text-muted-foreground">Becomes v{nextVersionNumber} draft</p>
						{/if}
					</div>
				</label>
				<input
					id="upload-file"
					type="file"
					accept=".gh,.ghx"
					bind:this={fileInput}
					onchange={onFilePick}
					class="hidden"
				/>
			</div>

			<div class="space-y-1.5">
				<Label for="upload-note">
					What changed? <span class="font-normal text-muted-foreground">(optional)</span>
				</Label>
				<Textarea
					id="upload-note"
					rows={2}
					maxlength={1000}
					placeholder="e.g. Fixed wall thickness calculation"
					bind:value={changeNote}
				/>
			</div>
		</div>

		<Dialog.Footer class="mt-4">
			<Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
			<Button onclick={submit} disabled={uploading || !fileName}>
				{#if uploading}
					Uploading…
				{:else}
					<Upload class="mr-1.5 h-3.5 w-3.5" />
					Upload v{nextVersionNumber}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
