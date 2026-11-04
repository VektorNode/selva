<script lang="ts">
	import { Button, Dialog, Input, Label, Textarea, FilterableDropdown } from '@selvajs/ui';
	import type { ProjectVisibility } from '@selvajs/platform/projects';

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onCreate: (payload: {
			name: string;
			description: string;
			visibility: ProjectVisibility;
		}) => Promise<void>;
	}

	let { open, onOpenChange, onCreate }: Props = $props();

	let name = $state('');
	let description = $state('');
	let visibility = $state<ProjectVisibility>('public');
	let creating = $state(false);

	const visibilityHint = $derived(
		{
			public: 'Any authenticated user can solve this project.',
			org: 'Any member of the organization can solve this project.',
			private: 'Only project members can solve this project.',
			platform: ''
		}[visibility]
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		creating = true;
		try {
			await onCreate({ name: name.trim(), description, visibility });
			name = '';
			description = '';
			visibility = 'public';
			onOpenChange(false);
		} catch {
			// onCreate already toasted the error; keep the dialog open so the input isn't lost.
		} finally {
			creating = false;
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>New project</Dialog.Title>
			<Dialog.Description
				>Projects group definitions and decide who can solve them.</Dialog.Description
			>
		</Dialog.Header>

		<form onsubmit={submit} class="mt-4 space-y-5">
			<div class="space-y-1.5">
				<Label for="new-proj-name">Name</Label>
				<Input id="new-proj-name" bind:value={name} autofocus />
			</div>
			<div class="space-y-1.5">
				<Label for="new-proj-desc">Description (optional)</Label>
				<Textarea id="new-proj-desc" bind:value={description} rows={3} />
			</div>
			<div class="space-y-1.5">
				<Label for="new-proj-vis">Visibility</Label>
				<FilterableDropdown
					id="new-proj-vis"
					items={[
						{ id: 'public', label: 'Public' },
						{ id: 'org', label: 'Org' },
						{ id: 'private', label: 'Private' }
					]}
					value={visibility}
					onChange={(v) => (visibility = v as ProjectVisibility)}
				/>
				<p class="text-muted-foreground text-xs">{visibilityHint}</p>
			</div>

			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
				<Button type="submit" disabled={creating || !name.trim()}>
					{creating ? 'Creating…' : 'Create project'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
