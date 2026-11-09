<script lang="ts">
	import { page } from '$app/state';
	import { Badge, Button, Callout, FilterableDropdown } from '@selvajs/ui';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
		form?: { error?: string };
	}

	let { data, form }: Props = $props();

	// Everything `write:all` reaches with a key. Org members, sending invites and
	// Compute servers are session-only, so they aren't listed.
	const CHANGES =
		'create, edit and delete projects and definitions, upload versions and make them live, share definitions by link, manage project members, revoke invites and change the organization’s branding';

	const ACCESS_TEXT = {
		read: 'Read: browse definitions and their inputs',
		solve: 'Read and run solves: spends your compute budget',
		write: `Read and change: ${CHANGES}.`,
		write_and_solve: `Read, run solves and change: ${CHANGES}. Solves spend your compute budget.`,
		upload:
			'Upload definitions: create definitions and new versions where you can, and make a version live. It can’t delete or share anything.',
		uploadAndCreate:
			'Upload definitions: create private projects, definitions and new versions where you can, and make a version live. It can’t delete or share anything.'
	} as const;

	// The widest level that can't delete is preselected, so one click on Allow
	// never grants `write`. Each level lists only the orgs it may be granted in.
	let picked = $state<string | undefined>();
	const level = $derived.by(() => {
		if (!data.ok) return undefined;
		const preselected = data.levels.filter((l) => !l.changes).at(-1) ?? data.levels[0];
		return data.levels.find((l) => l.access === picked) ?? preselected;
	});

	let pickedOrgId = $state<string | undefined>();
	const orgId = $derived(
		level?.orgs.some((o) => o.id === pickedOrgId) ? pickedOrgId : level?.orgId
	);
</script>

<svelte:head>
	<title>Connect an app - {page.data.branding.name}</title>
</svelte:head>

<div class="bg-background flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		{#if !data.ok}
			<div class="space-y-1 text-center">
				<h2 class="text-foreground text-2xl font-bold tracking-tight">Can’t connect</h2>
				<p class="text-muted-foreground text-sm">{data.problem}</p>
			</div>
		{:else}
			<div class="space-y-1 text-center">
				<h2 class="text-foreground text-2xl font-bold tracking-tight">
					Connect {data.clientName}
				</h2>
				{#if data.builtIn}
					<Badge variant="secondary">Built into {page.data.branding.name}</Badge>
				{:else}
					<p class="text-muted-foreground text-xs">
						The app chose this name itself. {page.data.branding.name} hasn’t checked it.
					</p>
				{/if}
				<p class="text-muted-foreground text-sm">
					{data.clientName} wants to use {page.data.branding.name} as you. It gets an API token that lasts
					{data.days} days. You can revoke it under Team → API tokens.
				</p>
			</div>

			<Callout tone={data.loopback ? 'warning' : 'info'}>
				The token goes to <span class="font-medium">{data.redirectHost}</span>.
				{#if data.loopback}
					That is a program on your own computer. Only continue if you just started this connection
					yourself.
				{/if}
			</Callout>

			{#if form?.error}
				<Callout tone="danger">{form.error}</Callout>
			{/if}

			<form method="POST" action="?{data.query}&/approve" class="space-y-4">
				{#if level && level.orgs.length > 1}
					<label class="block space-y-2 text-sm">
						<span class="text-foreground font-medium">Organization</span>
						<FilterableDropdown
							name="orgId"
							items={level.orgs.map((org) => ({ id: org.id, label: org.name }))}
							value={orgId}
							onChange={(v) => (pickedOrgId = v)}
						/>
					</label>
				{:else if level}
					<input type="hidden" name="orgId" value={orgId} />
					<p class="text-muted-foreground text-sm">
						In <span class="text-foreground font-medium">{level.orgs[0]?.name}</span>.
					</p>
				{/if}
				<fieldset class="space-y-2">
					<legend class="text-foreground text-sm font-medium">Access</legend>
					{#each data.levels as { access, createsProjects } (access)}
						<label class="flex items-start gap-2 text-sm">
							<input
								type="radio"
								name="access"
								value={access}
								checked={access === level?.access}
								onchange={() => (picked = access)}
							/>
							<span>{ACCESS_TEXT[createsProjects ? 'uploadAndCreate' : access]}</span>
						</label>
					{/each}
				</fieldset>
				<Button type="submit" class="w-full">Allow</Button>
			</form>
			<form method="POST" action="?{data.query}&/deny">
				<Button type="submit" variant="outline" class="w-full">Cancel</Button>
			</form>
		{/if}
	</div>
</div>
