<script lang="ts">
	import { Button, Callout, Input, Label, Spinner } from '@selvajs/ui';
	import { KeyRound } from '@lucide/svelte';
	import type { SelvaUpload } from '$lib/composables/useSelvaUpload.svelte';
	import { describeExtraScope, safeHttpUrl } from '$lib/composables/selva-upload-core';

	interface Props {
		upload: SelvaUpload;
	}

	let { upload }: Props = $props();

	const uploadState = $derived(upload.state);
	const account = $derived(uploadState.account);
	const checkingAddress = $derived(uploadState.afterConnect !== null);
	const otherKnownOrigins = $derived(
		(account?.knownOrigins ?? []).filter((o) => o !== uploadState.originInput.trim())
	);
	const tokensUrl = $derived(account?.origin ? safeHttpUrl(`${account.origin}/team/tokens`) : null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function initial(): string {
		const name = account?.user?.displayName || account?.user?.email || '?';
		return name.charAt(0).toUpperCase();
	}
</script>

{#if !account}
	<div class="text-muted-foreground flex items-center gap-2 py-2 text-sm">
		<Spinner />
		Checking your Selva sign-in…
	</div>
{:else if account.status === 'signedIn'}
	<div class="bg-muted/30 flex items-center gap-3 rounded-lg border px-3.5 py-3">
		<div
			class="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
			aria-hidden="true"
		>
			{initial()}
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium">
				{account.user?.displayName || account.user?.email}
				{#if account.user?.displayName}
					<span class="text-muted-foreground font-normal">· {account.user.email}</span>
				{/if}
			</p>
			<p class="text-muted-foreground truncate text-xs">
				{#if account.org}{account.org.name} on{/if}
				<span class="text-foreground font-mono">{account.host ?? account.origin}</span>
			</p>
			{#if account.expiresAt}
				<p class="text-muted-foreground text-xs">
					Signed in until {formatDate(account.expiresAt)}
				</p>
			{/if}
		</div>
		<Button variant="outline" size="sm" onclick={upload.signOut} disabled={uploadState.uploading}>
			Sign out
		</Button>
	</div>

	{#if account.extraScopes.length > 0}
		<Callout tone="warning" title="This key can do more than upload">
			<p>Anyone who copies it from this computer can also:</p>
			<ul class="mt-1 list-inside list-disc">
				{#each account.extraScopes as scope (scope)}
					<li>
						{describeExtraScope(scope)} (<code class="text-foreground text-xs">{scope}</code>)
					</li>
				{/each}
			</ul>
			<p class="mt-1">
				Make a key that can only upload
				{#if tokensUrl}
					at <a href={tokensUrl} target="_blank" rel="external noopener noreferrer"
						>Team → API tokens</a
					>,
				{:else}
					in Selva,
				{/if}
				then sign out and use that one here.
			</p>
		</Callout>
	{/if}
{:else if account.status === 'signingIn'}
	<div class="bg-muted/30 flex items-center gap-3 rounded-lg border px-3.5 py-3">
		<Spinner class="size-5" />
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">Waiting for you to approve in your browser…</p>
			{#if account.host ?? account.origin}
				<p class="text-muted-foreground truncate text-xs">
					Signing in to <span class="font-mono">{account.host ?? account.origin}</span>
				</p>
			{/if}
		</div>
		<Button variant="outline" size="sm" onclick={upload.cancel}>Cancel</Button>
	</div>
{:else}
	<form
		class="flex flex-col gap-3"
		onsubmit={(e) => {
			e.preventDefault();
			upload.signIn();
		}}
	>
		<div class="flex flex-col gap-1.5">
			<Label for="selva-origin">Selva instance</Label>
			<Input
				id="selva-origin"
				bind:value={uploadState.originInput}
				placeholder="https://selva.your-company.com"
				autocomplete="url"
				spellcheck={false}
			/>
			{#if otherKnownOrigins.length > 0}
				<div class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
					Used before:
					{#each otherKnownOrigins as origin (origin)}
						<button
							type="button"
							class="hover:bg-accent hover:text-foreground rounded-sm border px-1.5 py-0.5 font-mono transition-colors"
							onclick={() => (uploadState.originInput = origin)}
						>
							{origin}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<div class="flex items-center gap-3">
			<Button
				type="submit"
				size="sm"
				disabled={!upload.connected || !uploadState.originInput.trim() || checkingAddress}
			>
				{#if checkingAddress}<Spinner />{/if}
				Sign in
			</Button>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
				disabled={!upload.connected || !uploadState.originInput.trim() || checkingAddress}
				onclick={upload.useApiKey}
			>
				Use an API key
			</button>
		</div>
		<p class="text-muted-foreground text-xs">
			Your browser opens to sign in. Rhino keeps the sign-in; this page never sees it.
		</p>
	</form>

	{#if uploadState.awaitingKeyDialog}
		<Callout tone="info" icon={KeyRound}>Paste the key in the dialog Rhino opened.</Callout>
	{/if}
{/if}

{#if account?.message}
	<Callout tone="warning">{account.message}</Callout>
{/if}

{#if account?.status === 'signedIn' && account.storage === 'memory'}
	<Callout tone="info">
		This computer's credential store isn't available, so the sign-in only lasts until you close
		Rhino.
	</Callout>
{/if}
