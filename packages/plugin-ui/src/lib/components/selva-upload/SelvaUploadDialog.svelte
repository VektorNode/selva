<script lang="ts">
	import {
		Button,
		Callout,
		Dialog,
		Label,
		Separator,
		Spinner,
		Switch,
		unsupportedItems
	} from '@selvajs/ui';
	import type { UISchema } from '@selvajs/schemas';
	import { CloudUpload, FileText, RefreshCw } from '@lucide/svelte';
	import type { SelvaUpload } from '$lib/composables/useSelvaUpload.svelte';
	import { nowhereToUpload, selectedVersionTarget } from '$lib/composables/selva-upload-core';
	import { formatFileSize } from '$lib/utils/file-size';
	import SelvaAccountSection from './SelvaAccountSection.svelte';
	import UploadTargetSection from './UploadTargetSection.svelte';
	import UploadOutcome from './UploadOutcome.svelte';

	interface Props {
		upload: SelvaUpload;
		/** The schema being uploaded: what Selva will render of it. */
		schema?: UISchema | null;
	}

	let { upload, schema = null }: Props = $props();

	const leftOutOnSelva = $derived(schema ? unsupportedItems(schema, 'selva').length : 0);

	const uploadState = $derived(upload.state);
	const signedIn = $derived(uploadState.account?.status === 'signedIn');
	const targets = $derived(signedIn ? uploadState.targets : null);
	const showOutcome = $derived(uploadState.uploading || uploadState.result !== null);
	const showForm = $derived(
		!!targets && !showOutcome && !targets.blockedReason && !nowhereToUpload(targets)
	);
	const versionTarget = $derived(selectedVersionTarget(uploadState));
	const blocker = $derived(upload.blocker);
	const instance = $derived(
		uploadState.account?.host ?? uploadState.account?.origin ?? 'this instance'
	);

	const makeLiveHint = $derived.by(() => {
		const name = versionTarget?.displayName ?? 'the definition';
		if (uploadState.form.makeLive) {
			return `Everyone using ${name} gets this version once it's uploaded. You can roll back in Selva.`;
		}
		if (versionTarget?.liveVersionNumber != null) {
			return `It lands as the draft. Users keep version ${versionTarget.liveVersionNumber} until you make it live in Selva.`;
		}
		return "It lands as the draft. Make it live in Selva when it's ready.";
	});

	let body = $state<HTMLElement | null>(null);
</script>

<Dialog.Root
	open={uploadState.open}
	onOpenChange={(open) => {
		if (!open) upload.close();
	}}
>
	<!-- Focus starts on the body, not its first button: that is Sign out, one stray Enter away. -->
	<Dialog.Content
		variant="flush"
		class="flex flex-col sm:max-w-xl"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			body?.focus();
		}}
	>
		<div class="px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title>Upload to Selva</Dialog.Title>
				<Dialog.Description>
					Send this definition to Selva, as a new definition or as a new version of one that's
					already there.
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- The body scrolls on its own so the footer's buttons stay in view on a short window. -->
		<div
			bind:this={body}
			tabindex="-1"
			class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5 outline-none"
		>
			{#if !upload.connected}
				<Callout tone="warning">
					Not connected to Grasshopper. Check that the UI Bridge component is enabled.
				</Callout>
			{/if}

			{#if leftOutOnSelva > 0}
				<Callout tone="warning">
					{leftOutOnSelva === 1 ? '1 element' : `${leftOutOnSelva} elements`} of this UI only work in
					Rhino for now. Selva leaves {leftOutOnSelva === 1 ? 'it' : 'them'} out, and the definition solves
					with its own values there.
				</Callout>
			{/if}

			<section aria-label="Selva account" class="flex flex-col gap-3">
				<SelvaAccountSection {upload} />
			</section>

			{#if signedIn}
				<Separator />

				{#if showOutcome}
					<UploadOutcome
						stage={uploadState.stage}
						result={uploadState.result}
						makingLive={uploadState.form.makeLive}
					/>
				{:else if !targets}
					<div class="text-muted-foreground flex items-center gap-2 py-2 text-sm">
						<Spinner />
						Finding where you can upload…
					</div>
				{:else if targets.blockedReason}
					<Callout tone="warning" title="You can't upload right now">
						<p>{targets.blockedReason}</p>
						<Button variant="outline" size="sm" class="mt-2" onclick={upload.retryTargets}>
							<RefreshCw />
							Check again
						</Button>
					</Callout>
				{:else if nowhereToUpload(targets)}
					<Callout tone="warning" title="There's nowhere you can upload">
						You can't create definitions in any project{uploadState.account?.org
							? ` in ${uploadState.account.org.name}`
							: ''} on {instance}, and this file isn't linked to a definition you can edit. Ask
						whoever runs your Selva projects to add you to one.
					</Callout>
				{:else}
					<UploadTargetSection {upload} {targets} />

					<div class="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
						<div class="flex min-w-0 flex-col gap-1">
							<Label for="selva-make-live">Make live</Label>
							<p class="text-muted-foreground text-xs">{makeLiveHint}</p>
						</div>
						<Switch id="selva-make-live" bind:checked={uploadState.form.makeLive} />
					</div>

					<div class="text-muted-foreground flex items-start gap-2.5 text-xs">
						<FileText class="mt-px size-4 shrink-0" />
						<p>
							<span class="text-foreground font-mono">{targets.file.name}</span>
							· {formatFileSize(targets.file.sizeBytes)}. Uploads the whole definition, including
							internalised data and script source.
						</p>
					</div>
				{/if}
			{/if}
		</div>

		<div class="border-t px-6 py-4">
			<Dialog.Footer class="items-center">
				{#if uploadState.uploading}
					<Button variant="outline" onclick={upload.cancel}>Cancel upload</Button>
				{:else if uploadState.result?.ok}
					<Button onclick={upload.close}>Done</Button>
				{:else if uploadState.result}
					<Button variant="outline" onclick={upload.close}>Close</Button>
					<Button onclick={upload.dismissResult}>Back</Button>
				{:else if showForm}
					{#if blocker}
						<p class="text-muted-foreground text-xs sm:mr-auto">{blocker}</p>
					{/if}
					<Button variant="outline" onclick={upload.close}>Cancel</Button>
					<Button onclick={upload.upload} disabled={!!blocker}>
						<CloudUpload />
						Upload
					</Button>
				{:else}
					<Button variant="outline" onclick={upload.close}>Close</Button>
				{/if}
			</Dialog.Footer>
		</div>
	</Dialog.Content>
</Dialog.Root>
