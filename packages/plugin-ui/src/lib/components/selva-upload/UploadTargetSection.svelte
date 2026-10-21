<script lang="ts">
	import type { SelvaTargets, SelvaVersionTarget } from '@selvajs/schemas';
	import { MAX_CATEGORY_LENGTH, MAX_TAGS } from '@selvajs/schemas';
	import { Badge, Callout, Input, Label, Select, Textarea } from '@selvajs/ui';
	import TagEditor from '$lib/components/TagEditor.svelte';
	import type { SelvaUpload } from '$lib/composables/useSelvaUpload.svelte';
	import {
		canCreateDefinition,
		selectedVersionTarget,
		versionTargets
	} from '$lib/composables/selva-upload-core';

	interface Props {
		upload: SelvaUpload;
		targets: SelvaTargets;
	}

	let { upload, targets }: Props = $props();

	const uploadState = $derived(upload.state);
	const form = $derived(uploadState.form);
	const options = $derived(versionTargets(targets));
	const canCreate = $derived(canCreateDefinition(targets));
	const selectedVersion = $derived(selectedVersionTarget(uploadState));
	const selectedProject = $derived(targets.projects.find((p) => p.id === form.projectId));

	function isSuggestion(target: SelvaVersionTarget): boolean {
		return target.definitionGuid === targets.suggestion?.definitionGuid;
	}

	function isSelected(target: SelvaVersionTarget): boolean {
		return (
			uploadState.target?.kind === 'newVersion' &&
			uploadState.target.definitionGuid === target.definitionGuid
		);
	}

	function versionSummary(target: SelvaVersionTarget): string {
		const live = target.liveVersionNumber != null ? `, live is ${target.liveVersionNumber}` : '';
		const latest = `Latest is version ${target.latestVersionNumber}${live}.`;
		if (target.linkedVersionNumber != null) {
			return `This file last went up as version ${target.linkedVersionNumber}. ${latest}`;
		}
		return `Uploaded from this Grasshopper file before. ${latest}`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	const optionClass =
		'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:disabled]:hover:bg-transparent';
</script>

<fieldset class="flex flex-col gap-2">
	<legend class="mb-2 text-sm font-semibold">Upload as</legend>

	{#each options as target (target.definitionGuid)}
		<label class={optionClass}>
			<input
				type="radio"
				name="selva-upload-target"
				class="accent-primary mt-0.5 size-4 shrink-0"
				checked={isSelected(target)}
				onchange={() =>
					upload.selectTarget({ kind: 'newVersion', definitionGuid: target.definitionGuid })}
			/>
			<span class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="flex items-center gap-2 text-sm">
					<span class="min-w-0">
						New version of <strong class="font-semibold">{target.displayName}</strong>
						{#if target.projectName}
							in <strong class="font-semibold">{target.projectName}</strong>
						{/if}
					</span>
					{#if isSuggestion(target)}
						<Badge variant="secondary" class="ml-auto shrink-0">Suggested</Badge>
					{/if}
				</span>
				<span class="text-muted-foreground text-xs">{versionSummary(target)}</span>
			</span>
		</label>
	{/each}

	<label class={optionClass}>
		<input
			type="radio"
			name="selva-upload-target"
			class="accent-primary mt-0.5 size-4 shrink-0"
			checked={uploadState.target?.kind === 'newDefinition'}
			disabled={!canCreate}
			onchange={() => upload.selectTarget({ kind: 'newDefinition' })}
		/>
		<span class="flex min-w-0 flex-col gap-0.5">
			<span class="text-sm font-semibold">New definition</span>
			<span class="text-muted-foreground text-xs">
				{canCreate
					? 'Starts a definition of its own, in a project you pick.'
					: "You can't create definitions in any project."}
			</span>
		</span>
	</label>
</fieldset>

{#if selectedVersion && selectedVersion.newerVersions.length > 0}
	<Callout
		tone="warning"
		title="{selectedVersion.displayName} changed since this file's last upload"
	>
		<ul class="list-inside list-disc">
			{#each selectedVersion.newerVersions as version (version.versionNumber)}
				<li>
					{version.byYou ? 'You' : 'Someone else'} uploaded version {version.versionNumber} on
					{formatDate(version.uploadedAt)}{#if version.changeNote}: “{version.changeNote}”{/if}
				</li>
			{/each}
		</ul>
		<p class="mt-1">
			Your upload goes on top as the newest version. It's made from this file alone, so it won't
			have those changes unless this file has them too.
		</p>
	</Callout>
{/if}

{#if uploadState.target?.kind === 'newVersion'}
	<div class="flex flex-col gap-1.5">
		<Label for="selva-change-note">Change note</Label>
		<Textarea
			id="selva-change-note"
			bind:value={form.changeNote}
			placeholder="What changed? Shown in the definition's history."
			rows={2}
		/>
	</div>
{:else if uploadState.target?.kind === 'newDefinition'}
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-1.5">
			<Label for="selva-project">Project</Label>
			<Select.Root type="single" value={form.projectId} onValueChange={(v) => (form.projectId = v)}>
				<Select.Trigger id="selva-project" class="w-full">
					{#if selectedProject}
						{selectedProject.name}
					{:else}
						<span class="text-muted-foreground">Pick a project</span>
					{/if}
				</Select.Trigger>
				<Select.Content>
					{#each targets.projects as project (project.id)}
						<Select.Item value={project.id} label={project.name} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="selva-name">Name</Label>
			<Input id="selva-name" bind:value={form.displayName} />
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="selva-description">Description</Label>
			<Textarea id="selva-description" bind:value={form.description} rows={2} />
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="selva-category">Category</Label>
				<Input
					id="selva-category"
					bind:value={form.category}
					maxlength={MAX_CATEGORY_LENGTH}
					placeholder="e.g. Facade"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="selva-tags">Tags</Label>
				<TagEditor id="selva-tags" tags={form.tags} onChange={(tags) => (form.tags = tags)} />
			</div>
		</div>
		<p class="text-muted-foreground -mt-2 text-xs">
			Filled in from the schema's settings. Up to {MAX_TAGS} tags.
		</p>
	</div>
{/if}
