<script lang="ts">
	import { page } from '$app/state';
	import { Button, Input, Label, Alert } from '@selvajs/ui';
	import { CircleAlert } from '@lucide/svelte';
	import { fade } from 'svelte/transition';

	interface ActionData {
		error?: string;
		// Echoed back so a failed attempt does not wipe what the user typed.
		email?: string;
		// Increments per rejected submission. Two identical rejections render
		// identical pages otherwise, and the second one reads as a dead form.
		attempt?: number;
	}

	interface PageData {
		hasPasswordAuth: boolean;
		hasEmailLink: boolean;
		hasProxyAuth: boolean;
		// Forward-auth only: true when NONE of the identity headers arrived
		// (proxy wiring problem) vs false when headers arrived but the user
		// isn't allowlisted (access not granted). Drives which message shows.
		proxyHeadersMissing: boolean;
		// Forward-auth only: redacted snapshot of the incoming request headers,
		// shown in a collapsible block so operators can verify what the proxy
		// forwards while deployments are still being wired. Null otherwise.
		requestHeaders: Array<{ name: string; value: string }> | null;
		oauthProviders: string[];
	}

	interface Props {
		form?: ActionData;
		data: PageData;
	}

	let { form, data }: Props = $props();

	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');
	const submittedEmail = $derived(form?.email ?? '');
	const attempt = $derived(form?.attempt ?? 0);

	// A rejected submission is a full page render, so the field the user must
	// retype starts unfocused and the failure is easy to miss. Re-attaches on
	// every attempt because the count is read inside.
	function focusOnRetry(node: HTMLElement) {
		if (attempt > 0) node.focus();
	}

	function oauthHref(provider: string): string {
		// Plain string concatenation — `URLSearchParams` triggers a Svelte
		// reactivity lint warning, and we don't need reactivity for a static
		// link href.
		const qs = `provider=${encodeURIComponent(provider)}${
			redirectTo ? `&redirectTo=${encodeURIComponent(redirectTo)}` : ''
		}`;
		return `/auth/supabase/start?${qs}`;
	}

	function providerLabel(p: string): string {
		const labels: Record<string, string> = {
			google: 'Google',
			github: 'GitHub',
			azure: 'Microsoft',
			gitlab: 'GitLab'
		};
		return labels[p] ?? p;
	}

	const noAuthMethods = $derived(
		!data.hasPasswordAuth && !data.hasEmailLink && data.oauthProviders.length === 0
	);
</script>

<!--
	Temporary forward-auth diagnostic: render the incoming request headers so
	operators can confirm what the proxy forwards while a deployment is still
	being wired. Values for secret-bearing headers are redacted server-side.
	Remove once header-auth deployments have stabilized.
-->
{#snippet requestHeaderDump(headers: Array<{ name: string; value: string }>)}
	<details class="border-border rounded border p-3 text-xs">
		<summary class="text-muted-foreground cursor-pointer font-medium">
			Request headers ({headers.length})
		</summary>
		<pre
			class="text-muted-foreground mt-2 max-h-96 overflow-auto break-all whitespace-pre-wrap">{headers
				.map((h) => `${h.name}: ${h.value}`)
				.join('\n')}</pre>
	</details>
{/snippet}

<svelte:head>
	<title>Login - {page.data.branding.name}</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-1 text-center">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Sign in</h2>
			<p class="text-muted-foreground text-sm">Sign in to your account</p>
		</div>

		{#if form?.error}
			{#key attempt}
				<div in:fade={{ duration: 120 }}>
					<Alert.Root variant="destructive" aria-live="assertive">
						<CircleAlert />
						<Alert.Description>
							{form.error}{#if attempt > 1}
								<span class="opacity-80"> (attempt {attempt})</span>
							{/if}
						</Alert.Description>
					</Alert.Root>
				</div>
			{/key}
		{/if}

		{#if data.oauthProviders.length > 0}
			<div class="space-y-2">
				{#each data.oauthProviders as provider (provider)}
					<a href={oauthHref(provider)} class="block">
						<Button type="button" variant="outline" class="w-full">
							Continue with {providerLabel(provider)}
						</Button>
					</a>
				{/each}
			</div>
		{/if}

		{#if data.hasEmailLink && data.oauthProviders.length > 0}
			<div class="text-muted-foreground flex items-center gap-2 text-xs uppercase">
				<div class="bg-border h-px flex-1"></div>
				<span>or</span>
				<div class="bg-border h-px flex-1"></div>
			</div>
		{/if}

		{#if data.hasEmailLink}
			<form method="POST" action="/auth/email/start" class="space-y-4">
				{#if redirectTo}
					<input type="hidden" name="redirectTo" value={redirectTo} />
				{/if}
				<div class="space-y-2">
					<Label for="email-link-email">Email</Label>
					<Input
						id="email-link-email"
						name="email"
						type="email"
						required
						placeholder="you@example.com"
						value={submittedEmail}
					/>
				</div>
				<Button type="submit" variant="outline" class="w-full">Email me a sign-in link</Button>
			</form>
		{/if}

		{#if data.hasPasswordAuth && (data.hasEmailLink || data.oauthProviders.length > 0)}
			<div class="text-muted-foreground flex items-center gap-2 text-xs uppercase">
				<div class="bg-border h-px flex-1"></div>
				<span>or</span>
				<div class="bg-border h-px flex-1"></div>
			</div>
		{/if}

		{#if data.hasPasswordAuth}
			<form method="POST" class="space-y-4">
				{#if redirectTo}
					<input type="hidden" name="redirectTo" value={redirectTo} />
				{/if}
				<input type="hidden" name="attempt" value={attempt} />

				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						required
						placeholder="admin@example.com"
						value={submittedEmail}
					/>
				</div>

				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						placeholder="Password"
						aria-invalid={attempt > 0}
						{@attach focusOnRetry}
					/>
				</div>

				<Button type="submit" class="w-full">Sign in with password</Button>
			</form>
		{/if}

		{#if noAuthMethods && data.hasProxyAuth && data.proxyHeadersMissing}
			<div class="space-y-3">
				<p class="text-muted-foreground text-sm">
					This deployment uses forward-auth — sign-in happens upstream at your identity provider,
					not on this page. If you're seeing this page, your proxy didn't forward the identity
					headers. Check that:
				</p>
				<ul class="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
					<li>You're reaching the app through the proxy, not directly</li>
					<li>The proxy authenticated you (visit the IdP first if needed)</li>
					<li>The proxy is forwarding the configured identity header</li>
				</ul>
				<p class="text-muted-foreground text-xs">
					Operators: see <code>HEADER_AUTH_UPN_HEADER</code> and your proxy's forward-auth config.
				</p>
				{#if data.requestHeaders}
					{@render requestHeaderDump(data.requestHeaders)}
				{/if}
			</div>
		{:else if noAuthMethods && data.hasProxyAuth}
			<div class="space-y-3">
				<p class="text-muted-foreground text-sm">
					You're signed in with your identity provider, but your account hasn't been granted access
					to this deployment yet.
				</p>
				<p class="text-muted-foreground text-xs">
					Ask an administrator to add you to the allowlist. Once added, reload this page — no second
					sign-in is needed.
				</p>
				{#if data.requestHeaders}
					{@render requestHeaderDump(data.requestHeaders)}
				{/if}
			</div>
		{:else if noAuthMethods}
			<Alert.Root variant="destructive">
				<CircleAlert />
				<Alert.Description>
					No login methods are configured. Set up an auth provider before signing in.
				</Alert.Description>
			</Alert.Root>
		{/if}
	</div>
</div>
