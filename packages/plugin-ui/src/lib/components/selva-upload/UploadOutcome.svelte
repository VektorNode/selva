<script lang="ts">
	import type { SelvaUploadResult } from '@selvajs/schemas';
	import { Button, Callout, Spinner } from '@selvajs/ui';
	import { Check, Circle, CircleCheck, ExternalLink } from '@lucide/svelte';
	import { safeHttpUrl, type UploadStage } from '#lib/composables/selva-upload-core.js';

	interface Props {
		/** Set while uploading. */
		stage: UploadStage | null;
		result: SelvaUploadResult | null;
		/** Whether the upload in flight also makes the version live, so the last step is shown. */
		makingLive: boolean;
	}

	let { stage, result, makingLive }: Props = $props();

	interface Step {
		stage: UploadStage;
		label: string;
		detail?: string;
	}

	const STEPS: Step[] = [
		{ stage: 'preparing', label: 'Preparing the file' },
		{
			stage: 'uploading',
			label: 'Uploading',
			detail: 'Selva opens the file on Rhino.Compute to check it before it answers.'
		},
		{ stage: 'publishing', label: 'Making it live' }
	];

	const steps = $derived(makingLive ? STEPS : STEPS.filter((s) => s.stage !== 'publishing'));
	const currentIndex = $derived(steps.findIndex((s) => s.stage === stage));
	const selvaUrl = $derived(safeHttpUrl(result?.url));
</script>

{#if stage}
	<ol class="flex flex-col gap-3 py-1" aria-label="Upload progress">
		{#each steps as step, i (step.stage)}
			<li class="flex items-start gap-3">
				<span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
					{#if i < currentIndex}
						<Check class="text-success size-4" aria-label="Done" />
					{:else if i === currentIndex}
						<Spinner aria-label="In progress" />
					{:else}
						<Circle class="text-muted-foreground/50 size-3.5" aria-label="Not started" />
					{/if}
				</span>
				<span class="flex flex-col gap-0.5">
					<span class="text-sm {i > currentIndex ? 'text-muted-foreground' : 'font-medium'}">
						{step.label}
					</span>
					{#if step.detail && i === currentIndex}
						<span class="text-muted-foreground text-xs">{step.detail}</span>
					{/if}
				</span>
			</li>
		{/each}
	</ol>
{:else if result?.cancelled}
	<Callout tone="tip" title="Upload cancelled">
		Go back to change something and try again, or close this.
	</Callout>
{:else if result?.ok}
	<div class="flex flex-col items-center gap-3 py-4 text-center">
		<CircleCheck class="text-success size-10" strokeWidth={1.5} />
		<div class="flex flex-col gap-1">
			<p class="text-base font-semibold">
				Uploaded {result.displayName ?? 'the definition'}{#if result.versionNumber != null}, version
					{result.versionNumber}{/if}
			</p>
			<p class="text-muted-foreground max-w-sm text-sm">
				{#if result.live}
					It's live: everyone using the definition now gets this version. You can roll back in
					Selva.
				{:else if !result.error}
					It's the draft. Try it in Selva, and make it live there when it's ready.
				{/if}
			</p>
		</div>
		{#if selvaUrl}
			<Button variant="outline" href={selvaUrl} target="_blank" rel="external noopener noreferrer">
				Open in Selva
				<ExternalLink />
			</Button>
		{/if}
	</div>

	<!-- `error` on a success: the version went up, but making it live failed. -->
	{#if result.error}
		<Callout tone="warning" title="It isn't live">
			{result.error} You can make it live from the definition's page in Selva.
		</Callout>
	{/if}
{:else if result}
	<Callout tone="danger" title="Upload failed">
		{result.error ?? 'Selva gave no reason.'}
	</Callout>
{/if}
