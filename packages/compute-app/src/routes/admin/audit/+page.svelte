<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import { ScrollText, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Admin · Audit log</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Audit log"
		description="Every domain event recorded on this instance — actor, type, target, timestamp."
	/>

	<Card.Root>
		<Card.Content class="pt-6">
			<div class="bg-muted/30 flex items-start gap-4 rounded-lg border p-5">
				<div class="bg-accent text-accent-foreground rounded-md p-2.5">
					<ShieldCheck class="h-4 w-4" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Audit data is being recorded</p>
					<p class="text-muted-foreground mt-1 text-sm">
						Every reclaim, role change, share-link mint, project mutation, and member action on this
						instance is persisted to the audit store from day one. The browsing UI — filtering by
						actor, type, and time window — is queued for the next pass once a query interface lands
						on the platform.
					</p>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">What's tracked</Card.Title>
		</Card.Header>
		<Card.Content>
			<ul class="text-muted-foreground space-y-2 text-sm">
				<li class="flex items-start gap-2">
					<ScrollText class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Org & member changes — create, update, delete, role changes, transfer.</span>
				</li>
				<li class="flex items-start gap-2">
					<ScrollText class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Project mutations — visibility changes, member add/remove, reclaim.</span>
				</li>
				<li class="flex items-start gap-2">
					<ScrollText class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Definition lifecycle — upload, version publish, delete.</span>
				</li>
				<li class="flex items-start gap-2">
					<ScrollText class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Share links — mint, revoke, cap-reached events.</span>
				</li>
			</ul>
		</Card.Content>
	</Card.Root>
</div>
