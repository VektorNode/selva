<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import { Pencil, ArrowRightLeft, Trash2 } from '@lucide/svelte';
	import type { Organization } from '@selvajs/platform';

	interface PageData {
		org: Organization | null;
		isOwner: boolean;
	}
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Team · Settings</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Settings"
		description="Organization name, slug, ownership, and the danger zone."
	/>

	{#if data.org}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm font-medium">Identity</Card.Title>
				<Card.Description>The org's display name and URL slug.</Card.Description>
			</Card.Header>
			<Card.Content>
				<dl class="grid gap-y-2 gap-x-4 text-sm sm:grid-cols-[140px_1fr_120px]">
					<dt class="text-muted-foreground">Name</dt>
					<dd class="font-medium">{data.org.name}</dd>
					<dd class="text-right">
						<button
							type="button"
							disabled
							class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground opacity-60"
						>
							<Pencil class="h-3 w-3" />
							Edit
						</button>
					</dd>

					<dt class="text-muted-foreground">Slug</dt>
					<dd><code class="font-mono text-xs">{data.org.slug}</code></dd>
					<dd class="text-right">
						<button
							type="button"
							disabled
							class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground opacity-60"
						>
							<Pencil class="h-3 w-3" />
							Edit
						</button>
					</dd>

					<dt class="text-muted-foreground">Org ID</dt>
					<dd>
						<code class="font-mono text-xs text-muted-foreground">{data.org.id}</code>
					</dd>
					<dd></dd>
				</dl>
				<p class="mt-3 text-xs text-muted-foreground">
					Editing identity ships when the corresponding API endpoint lands.
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm font-medium">Ownership</Card.Title>
				<Card.Description>
					{data.isOwner
						? 'You are the current owner of this organization.'
						: 'Only the current owner can transfer ownership.'}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<button
					type="button"
					disabled
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground opacity-60"
				>
					<ArrowRightLeft class="h-3.5 w-3.5" />
					Transfer ownership
				</button>
				<p class="mt-3 text-xs text-muted-foreground">
					Transfer flow ships with the matching API endpoint.
				</p>
			</Card.Content>
		</Card.Root>

		{#if data.isOwner}
			<Card.Root class="border-destructive/40">
				<Card.Header>
					<Card.Title class="text-sm font-medium text-destructive">Danger zone</Card.Title>
					<Card.Description>
						Deleting an organization removes all members, projects, and definitions. Cannot be
						undone.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<button
						type="button"
						disabled
						class="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive opacity-60"
					>
						<Trash2 class="h-3.5 w-3.5" />
						Delete organization
					</button>
					<p class="mt-3 text-xs text-muted-foreground">
						Org deletion ships with the matching API endpoint.
					</p>
				</Card.Content>
			</Card.Root>
		{/if}
	{:else}
		<Card.Root>
			<Card.Content class="pt-6 text-sm text-muted-foreground">
				No active organization. Switch orgs from the user menu.
			</Card.Content>
		</Card.Root>
	{/if}
</div>
