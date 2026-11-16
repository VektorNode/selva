<script lang="ts">
	import { Button, Callout, Dialog, Label, toast } from '@selvajs/ui';
	import { Upload, FileUp, LoaderCircle, CircleCheck } from '@lucide/svelte';
	import { refreshAll } from '$app/navigation';
	import { MAX_CHANGE_NOTE_LENGTH } from '@selvajs/platform';
	import { schemaDiffToMarkdown, type SchemaDiff } from '@selvajs/schemas';
	import VersionChanges from './VersionChanges.svelte';
	import NoteEditor from './NoteEditor.svelte';

	interface Props {
		definitionGuid: string;
		nextVersionNumber: number;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onUploaded: () => void;
	}

	let { definitionGuid, nextVersionNumber, open, onOpenChange, onUploaded }: Props = $props();

	interface CheckResult {
		schema: { name: string; inputs: number; outputs: number };
		base: { id: string; versionNumber: number } | null;
		changes: SchemaDiff | null;
	}

	type Check =
		| { state: 'idle' }
		| { state: 'checking' }
		| { state: 'valid'; result: CheckResult }
		| { state: 'invalid'; message: string };

	const NOTE_PLACEHOLDER = [
		'## Thicker walls',
		'',
		'- Wall thickness now follows the span',
		'- Fixed the corner overlap'
	].join('\n');

	let fileInput = $state<HTMLInputElement>();
	let file = $state<File | null>(null);
	let changeNote = $state('');
	let check = $state<Check>({ state: 'idle' });
	let uploading = $state(false);
	let breakingAcknowledged = $state(false);
	// A newer pick supersedes a check still in flight.
	let checkRun = 0;

	$effect(() => {
		if (!open) reset();
	});

	function reset() {
		file = null;
		changeNote = '';
		check = { state: 'idle' };
		uploading = false;
		breakingAcknowledged = false;
		checkRun++;
		if (fileInput) fileInput.value = '';
	}

	async function errorMessage(res: Response): Promise<string> {
		const body = await res.json().catch(() => ({}));
		return body.message || body.error || `The server answered ${res.status}`;
	}

	async function onFilePick() {
		file = fileInput?.files?.[0] ?? null;
		breakingAcknowledged = false;
		if (!file) {
			check = { state: 'idle' };
			return;
		}
		const run = ++checkRun;
		check = { state: 'checking' };
		const formData = new FormData();
		formData.append('file', file);
		try {
			const res = await fetch(`/api/v1/definitions/${definitionGuid}/versions/check`, {
				method: 'POST',
				body: formData
			});
			if (run !== checkRun) return;
			check = res.ok
				? { state: 'valid', result: (await res.json()) as CheckResult }
				: { state: 'invalid', message: await errorMessage(res) };
		} catch {
			if (run === checkRun) check = { state: 'invalid', message: 'Could not reach the server.' };
		}
	}

	const diff = $derived(check.state === 'valid' ? check.result.changes : null);
	const breaking = $derived(diff?.counts.breaking ?? 0);
	const suggestion = $derived(diff && !diff.identical ? schemaDiffToMarkdown(diff) : null);
	const canUpload = $derived(
		check.state === 'valid' &&
			!uploading &&
			changeNote.length <= MAX_CHANGE_NOTE_LENGTH &&
			(breaking === 0 || breakingAcknowledged)
	);

	async function submit() {
		if (!file || !canUpload) return;
		uploading = true;
		const formData = new FormData();
		formData.append('file', file);
		if (changeNote.trim()) formData.append('changeNote', changeNote.trim());
		try {
			const res = await fetch(`/api/v1/definitions/${definitionGuid}/versions`, {
				method: 'POST',
				body: formData
			});
			if (!res.ok) {
				toast.error(await errorMessage(res));
				return;
			}
			const result = await res.json();
			toast.success(`v${result.version?.versionNumber ?? nextVersionNumber} uploaded as draft`);
			onUploaded();
			await refreshAll();
			onOpenChange(false);
		} catch {
			toast.error('Upload failed');
		} finally {
			uploading = false;
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Upload new version</Dialog.Title>
			<Dialog.Description>
				The upload becomes <strong>v{nextVersionNumber}</strong> as a draft. The live version stays unchanged
				until you publish.
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-4 space-y-4">
			<div class="space-y-1.5">
				<Label for="upload-file">Grasshopper file</Label>
				<label
					for="upload-file"
					class="border-border-strong hover:bg-hover flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed px-4 py-4 transition-colors"
				>
					<FileUp class="text-faint-foreground h-5 w-5 shrink-0" />
					<div class="min-w-0 flex-1">
						{#if file}
							<p class="truncate text-sm font-medium">{file.name}</p>
							<p class="text-muted-foreground text-xs">Click to choose a different file</p>
						{:else}
							<p class="text-sm font-medium">Pick a .gh or .ghx file</p>
							<p class="text-muted-foreground text-xs">
								It is checked through Compute before anything is saved
							</p>
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

			{#if check.state === 'checking'}
				<div class="text-muted-foreground flex items-center gap-2 text-sm">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					Checking the file through Compute…
				</div>
			{:else if check.state === 'invalid'}
				<Callout tone="danger" title="This file can't be uploaded">
					{check.message}
				</Callout>
			{:else if check.state === 'valid'}
				{@const { schema, base } = check.result}
				<div class="space-y-3 rounded-lg border p-3">
					<div class="flex items-center gap-2 text-sm">
						<CircleCheck class="text-success h-4 w-4 shrink-0" />
						<span>
							<strong>Valid.</strong>
							{schema.inputs}
							{schema.inputs === 1 ? 'input' : 'inputs'}, {schema.outputs}
							{schema.outputs === 1 ? 'output' : 'outputs'}.
						</span>
						{#if base}
							<span class="text-muted-foreground ml-auto text-xs">
								compared with v{base.versionNumber}
							</span>
						{/if}
					</div>
					{#if diff}
						<VersionChanges {diff} />
					{:else if base}
						<p class="text-muted-foreground text-sm">
							v{base.versionNumber} has no stored schema, so changes can't be listed.
						</p>
					{:else}
						<p class="text-muted-foreground text-sm">The first version: nothing to compare with.</p>
					{/if}
				</div>

				{#if breaking > 0}
					<Callout
						tone="warning"
						title="{breaking} breaking {breaking === 1 ? 'change' : 'changes'}"
					>
						<label class="mt-1 flex items-start gap-2 text-sm">
							<input type="checkbox" class="mt-0.5" bind:checked={breakingAcknowledged} />
							<span>
								I understand that saved values, share links and API callers using these may break
								once this version goes live.
							</span>
						</label>
					</Callout>
				{/if}
			{/if}

			<div class="space-y-1.5">
				<Label for="upload-note">
					Release notes <span class="text-muted-foreground font-normal">(optional)</span>
				</Label>
				<NoteEditor
					id="upload-note"
					bind:value={changeNote}
					{suggestion}
					placeholder={NOTE_PLACEHOLDER}
				/>
			</div>
		</div>

		<Dialog.Footer class="mt-4">
			<Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
			<Button onclick={submit} disabled={!canUpload}>
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
