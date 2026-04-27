<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import { Link2, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Team · Share links</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Share links"
		description="Every share link your team has minted across all definitions."
	/>

	<Card.Root>
		<Card.Content class="pt-6">
			<div class="bg-muted/30 flex items-start gap-4 rounded-lg border p-5">
				<div class="bg-accent text-accent-foreground rounded-md p-2.5">
					<ShieldCheck class="h-4 w-4" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Share links work today — per definition</p>
					<p class="text-muted-foreground mt-1 text-sm">
						You can mint, list, and revoke share links from each definition's detail page. The
						org-wide aggregate view (every link across every definition, with usage and revoke
						controls) lands when a `listByOrg` query method is added to the share-link store.
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
					<Link2 class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Every active link — definition, channel, label, mint date, mint user.</span>
				</li>
				<li class="flex items-start gap-2">
					<Link2 class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Solve cap and current usage count.</span>
				</li>
				<li class="flex items-start gap-2">
					<Link2 class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>Expiry date and revocation status.</span>
				</li>
				<li class="flex items-start gap-2">
					<Link2 class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
					<span>One-click revoke from the team-wide list.</span>
				</li>
			</ul>
		</Card.Content>
	</Card.Root>
</div>
