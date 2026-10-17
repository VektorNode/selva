<script lang="ts">
	import {
		AlertDialog,
		Badge,
		Button,
		Callout,
		Card,
		DataTable,
		EmptyState,
		Input,
		Label,
		SectionHeader,
		Select,
		toast
	} from '@selvajs/ui';
	import { Check, Copy, KeyRound, Trash2 } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import { API_TOKEN_LIFETIME_DAYS, describeApiScope } from '@selvajs/platform';
	import {
		ACCESS_PRESETS,
		tokenState,
		tokenWarnings,
		type AccessPreset,
		type TokenRow
	} from '$lib/apiTokens';
	import type { PageData } from './$types';
	import type { RosterRow } from './+page.server';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let access = $state<AccessPreset>('read');
	let lifetime = $state<string>('30');
	let creating = $state(false);
	let secret = $state<string | null>(null);
	let copied = $state(false);
	let confirmingRevoke = $state<TokenRow | null>(null);
	let revokingId = $state<string | null>(null);

	const risky = $derived(access !== 'read');

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!data.orgId) return;
		creating = true;
		try {
			const res = await fetch(`/api/v1/orgs/${data.orgId}/tokens`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name,
					scopes: ACCESS_PRESETS[access].scopes,
					expiresInDays: Number(lifetime)
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(body.message || 'Failed to create the token');
				return;
			}
			secret = body.secret;
			copied = false;
			name = '';
			access = 'read';
			await invalidateAll();
		} catch {
			toast.error('Failed to create the token');
		} finally {
			creating = false;
		}
	}

	async function copySecret() {
		if (!secret) return;
		await navigator.clipboard.writeText(secret);
		copied = true;
	}

	async function revoke(token: TokenRow) {
		if (!data.orgId) return;
		revokingId = token.id;
		try {
			const res = await fetch(`/api/v1/orgs/${data.orgId}/tokens/${token.id}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				toast.success('Token revoked');
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || 'Failed to revoke the token');
			}
		} catch {
			toast.error('Failed to revoke the token');
		} finally {
			revokingId = null;
			confirmingRevoke = null;
		}
	}

	function formatDate(iso: string | null): string {
		return iso ? new Date(iso).toLocaleDateString() : 'Never';
	}

	const STATE_LABEL = { revoked: 'Revoked', expired: 'Expired' } as const;
</script>

<svelte:head>
	<title>Settings · API tokens</title>
</svelte:head>

{#snippet tokenCells(token: TokenRow)}
	{@const state = tokenState(token)}
	<div class="min-w-0">
		<div class="flex flex-wrap items-center gap-2">
			<span class="truncate text-sm font-medium" class:text-muted-foreground={state !== 'live'}>
				{token.name}
			</span>
			{#if state !== 'live'}
				<Badge variant="outline">{STATE_LABEL[state]}</Badge>
			{/if}
			{#each tokenWarnings(token) as warning (warning)}
				<Badge variant="secondary">{warning}</Badge>
			{/each}
		</div>
		<p class="text-muted-foreground truncate text-xs">
			{token.scopes.map(describeApiScope).join(' · ')}
		</p>
	</div>
	<span class="text-muted-foreground text-xs">{formatDate(token.lastUsedAt)}</span>
	<span class="text-muted-foreground text-xs">{formatDate(token.expiresAt)}</span>
	<div class="flex justify-end">
		{#if state === 'live'}
			<Button
				size="icon-sm"
				variant="ghost"
				disabled={revokingId === token.id}
				onclick={() => (confirmingRevoke = token)}
				aria-label="Revoke token"
			>
				<Trash2 />
			</Button>
		{/if}
	</div>
{/snippet}

<div class="mx-auto max-w-4xl space-y-6">
	<SectionHeader
		eyebrow="Settings"
		title="API tokens"
		description="Keys that let a script or an integration call the API as you. Send one in the Authorization header as a bearer token."
	/>

	{#if !data.available}
		<Callout tone="warning" title="API tokens aren't available on this server">
			Ask the operator to check the server configuration.
		</Callout>
	{:else if !data.orgId}
		<Callout tone="info" title="No organization">
			A token acts inside one organization. Join one first.
		</Callout>
	{:else if !data.canMint}
		<Callout tone="info" title="You can't create tokens yet">
			Ask an instance admin to give you the “Manage API tokens” permission.
		</Callout>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>New token</Card.Title>
				<Card.Description>
					It acts as you, can never do more than you can, and reaches only this organization.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if secret}
					<Callout tone="success" title="Copy your token now. You won't see it again.">
						<div class="flex items-center gap-2">
							<code class="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-sm">
								{secret}
							</code>
							<Button size="sm" variant="outline" onclick={copySecret}>
								{#if copied}<Check />Copied{:else}<Copy />Copy{/if}
							</Button>
							<Button size="sm" onclick={() => (secret = null)}>Done</Button>
						</div>
					</Callout>
				{:else}
					<form class="grid gap-4 sm:grid-cols-3" onsubmit={create}>
						<div class="flex flex-col gap-1.5 sm:col-span-3">
							<Label for="token-name">Name</Label>
							<Input
								id="token-name"
								bind:value={name}
								placeholder="What uses it, e.g. “Nightly export”"
								maxlength={100}
								required
							/>
						</div>
						<div class="flex flex-col gap-1.5 sm:col-span-2">
							<Label for="token-access">Access</Label>
							<Select.Root
								type="single"
								value={access}
								onValueChange={(v) => (access = (v as AccessPreset) ?? 'read')}
							>
								<Select.Trigger id="token-access">
									<span class="truncate">{ACCESS_PRESETS[access].label}</span>
								</Select.Trigger>
								<Select.Content>
									{#each Object.entries(ACCESS_PRESETS) as [key, preset] (key)}
										<Select.Item value={key} label={preset.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="token-lifetime">Expires after</Label>
							<Select.Root
								type="single"
								value={lifetime}
								onValueChange={(v) => (lifetime = v ?? '30')}
							>
								<Select.Trigger id="token-lifetime">
									<span>{lifetime} days</span>
								</Select.Trigger>
								<Select.Content>
									{#each API_TOKEN_LIFETIME_DAYS as days (days)}
										<Select.Item value={String(days)} label={`${days} days`} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						{#if risky}
							<Callout tone="warning" class="sm:col-span-3">
								{access === 'solve'
									? 'Solves use compute and count against your solve limit.'
									: 'Anyone holding this token can change or delete what you can, until it expires or you revoke it.'}
							</Callout>
						{/if}
						<div class="sm:col-span-3">
							<Button type="submit" disabled={creating || !name.trim()}>Create token</Button>
						</div>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if data.available && data.orgId}
		<Card.Root>
			<Card.Header>
				<Card.Title>Your tokens</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if data.mine.length === 0}
					<EmptyState
						icon={KeyRound}
						title="No tokens"
						description="Tokens you create appear here, including revoked and expired ones."
					/>
				{:else}
					<DataTable
						rows={data.mine}
						getKey={(t) => t.id}
						columns={[
							{ label: 'Token' },
							{ label: 'Last used', width: '110px' },
							{ label: 'Expires', width: '110px' },
							{ label: '', width: '56px' }
						]}
					>
						{#snippet row(token)}
							{@render tokenCells(token)}
						{/snippet}
					</DataTable>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if data.canManageRoster}
			<Card.Root>
				<Card.Header>
					<Card.Title>Everyone's tokens</Card.Title>
					<Card.Description>
						Every token in this organization. Revoke any you don't recognise.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if data.roster.length === 0}
						<p class="text-muted-foreground py-6 text-center text-sm">No tokens yet.</p>
					{:else}
						<DataTable
							rows={data.roster}
							getKey={(t) => t.id}
							columns={[
								{ label: 'Owner', width: '160px' },
								{ label: 'Token' },
								{ label: 'Last used', width: '110px' },
								{ label: 'Expires', width: '110px' },
								{ label: '', width: '56px' }
							]}
						>
							{#snippet row(token: RosterRow)}
								<span class="truncate text-sm">
									{token.ownerName ?? token.userId}
								</span>
								{@render tokenCells(token)}
							{/snippet}
						</DataTable>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

<AlertDialog.Root open={!!confirmingRevoke} onOpenChange={(o) => !o && (confirmingRevoke = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke this token?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if confirmingRevoke}
					Anything using <strong>{confirmingRevoke.name}</strong> stops working immediately. A revoked
					token can't be restored.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => confirmingRevoke && revoke(confirmingRevoke)}>
				Revoke token
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
