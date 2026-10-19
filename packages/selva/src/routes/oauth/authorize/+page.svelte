<script lang="ts">
	import { page } from '$app/state';
	import { Button, Callout } from '@selvajs/ui';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
		form?: { error?: string };
	}

	let { data, form }: Props = $props();
</script>

<svelte:head>
	<title>Connect an app - {page.data.branding.name}</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
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
				<p class="text-muted-foreground text-sm">
					{data.clientName} wants to use {page.data.branding.name} as you, in {data.orgName}. It
					gets an API token that lasts {data.days} days. You can revoke it under Settings → API tokens.
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
				<fieldset class="space-y-2">
					<legend class="text-foreground text-sm font-medium">Access</legend>
					<label class="flex items-start gap-2 text-sm">
						<input
							type="radio"
							name="access"
							value="read"
							checked={!data.scopes.includes('solve')}
						/>
						<span>Read: browse definitions and their inputs</span>
					</label>
					{#if data.scopes.includes('solve')}
						<label class="flex items-start gap-2 text-sm">
							<input type="radio" name="access" value="solve" checked />
							<span>Read and run solves: spends your compute budget</span>
						</label>
					{/if}
				</fieldset>
				<Button type="submit" class="w-full">Allow</Button>
			</form>
			<form method="POST" action="?{data.query}&/deny">
				<Button type="submit" variant="outline" class="w-full">Cancel</Button>
			</form>
		{/if}
	</div>
</div>
