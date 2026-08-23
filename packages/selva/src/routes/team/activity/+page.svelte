<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import { Activity, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Team · Activity</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Activity"
		description="Solve runs, edits, and admin actions across this organization."
	/>

	<Card.Root>
		<Card.Content class="pt-6">
			<div class="bg-muted/30 flex items-start gap-4 rounded-lg border p-5">
				<div class="bg-accent text-accent-foreground rounded-md p-2.5">
					<ShieldCheck class="h-4 w-4" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Activity is being recorded</p>
					<p class="text-muted-foreground mt-1 text-sm">
						Every solve, definition edit, member change, and project mutation in this org is
						persisted to the audit store. The org-scoped activity feed surfaces here as soon as a
						query interface lands on the platform.
					</p>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">What you'll see here</Card.Title>
		</Card.Header>
		<Card.Content>
			<ul class="text-muted-foreground space-y-2 text-sm">
				<li class="flex items-start gap-2">
					<Activity class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Solve runs — definition, who, when, duration, status.</span>
				</li>
				<li class="flex items-start gap-2">
					<Activity class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Member changes — invites accepted, role updates, removals.</span>
				</li>
				<li class="flex items-start gap-2">
					<Activity class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Project mutations — created, visibility changed, deleted, reclaimed.</span>
				</li>
				<li class="flex items-start gap-2">
					<Activity class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Definition lifecycle — uploads, version publishes, deletes.</span>
				</li>
			</ul>
		</Card.Content>
	</Card.Root>
</div>
