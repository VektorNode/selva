<script lang="ts">
	import { page } from '$app/state';
	import { Button, Input, Label, Callout } from '@selvajs/ui';

	interface ActionData {
		error?: string;
	}

	interface PageData {
		hasPasswordAuth: boolean;
		hasEmailLink: boolean;
		hasProxyAuth: boolean;
		pinned: boolean;
		bootstrapEmail: string | null;
		oauthProviders: string[];
		setupToken: string | null;
		devSetupToken: string | null;
	}

	interface Props {
		form?: ActionData;
		data: PageData;
	}

	let { form, data }: Props = $props();

	const hasIdp = $derived(data.oauthProviders.length > 0 || data.hasEmailLink || data.hasProxyAuth);
	const proxyOnly = $derived(
		data.hasProxyAuth &&
			!data.hasPasswordAuth &&
			!data.hasEmailLink &&
			data.oauthProviders.length === 0
	);
	// An IdP sign-in proves the pinned email. Without a pin only the setup link
	// proves anything; the password form always needs it.
	const idpCanClaim = $derived(data.pinned || data.setupToken !== null);
	const passwordCanClaim = $derived(data.hasPasswordAuth && data.setupToken !== null);
	const needsLink = $derived(
		data.setupToken === null && (data.hasPasswordAuth || (hasIdp && !data.pinned))
	);

	function oauthHref(provider: string): string {
		// The callback grants instance_admin when no admin exists yet. Plain string
		// concat — Svelte's lint flags a mutable URLSearchParams here.
		return `/auth/supabase/start?provider=${encodeURIComponent(provider)}&redirectTo=%2Fadmin`;
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
</script>

<svelte:head>
	<title>Setup - {page.data.branding.name}</title>
</svelte:head>

<div class="bg-background flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-1 text-center">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Create Admin Account</h2>
			<p class="text-muted-foreground text-sm">
				No users found. Set up your platform admin account to get started.
			</p>
		</div>

		{#if form?.error}
			<Callout tone="danger">
				{form.error}
			</Callout>
		{/if}

		{#if needsLink}
			<Callout tone="info">
				<p>
					{#if data.pinned}
						Creating the admin with a password needs the setup link.
					{:else}
						Claiming this instance needs the setup link.
					{/if}
					On the server, run <code>npx selva setup-url</code> and open the link it prints.
				</p>
				{#if hasIdp && !data.pinned}
					<p class="mt-2">
						Or set <code>BOOTSTRAP_INSTANCE_ADMIN_EMAIL</code> in <code>.env</code>, restart, and
						sign in with that address.
					</p>
				{/if}
				{#if data.devSetupToken}
					<p class="mt-2">
						<a class="underline" href="/setup?token={data.devSetupToken}">
							Dev server: continue without the CLI
						</a>
					</p>
				{/if}
			</Callout>
		{/if}

		{#if idpCanClaim && data.oauthProviders.length > 0}
			<div class="space-y-2">
				<p class="text-muted-foreground text-center text-xs">
					{data.pinned
						? 'Sign in with the configured admin email to become the platform admin.'
						: 'Sign in from this browser to become the platform admin.'}
				</p>
				{#each data.oauthProviders as provider (provider)}
					<a href={oauthHref(provider)} class="block">
						<Button type="button" variant="outline" class="w-full">
							Continue with {providerLabel(provider)}
						</Button>
					</a>
				{/each}
			</div>
		{/if}

		{#if idpCanClaim && data.hasEmailLink && data.oauthProviders.length > 0}
			<div class="text-muted-foreground flex items-center gap-2 text-xs uppercase">
				<div class="bg-border h-px flex-1"></div>
				<span>or</span>
				<div class="bg-border h-px flex-1"></div>
			</div>
		{/if}

		{#if idpCanClaim && data.hasEmailLink}
			<form method="POST" action="/auth/email/start?redirectTo=%2Fadmin" class="space-y-4">
				<p class="text-muted-foreground text-center text-xs">
					{data.pinned
						? 'Sign in via email link, with the configured admin email.'
						: 'Sign in via email link, and open the link in this browser.'}
				</p>
				<div class="space-y-2">
					<Label for="bootstrap-email">Email</Label>
					<Input
						id="bootstrap-email"
						name="email"
						type="email"
						required
						placeholder="admin@example.com"
					/>
				</div>
				<Button type="submit" variant="outline" class="w-full">Email me a sign-in link</Button>
			</form>
		{/if}

		{#if passwordCanClaim && idpCanClaim && (data.hasEmailLink || data.oauthProviders.length > 0)}
			<div class="text-muted-foreground flex items-center gap-2 text-xs uppercase">
				<div class="bg-border h-px flex-1"></div>
				<span>or</span>
				<div class="bg-border h-px flex-1"></div>
			</div>
		{/if}

		{#if passwordCanClaim}
			<form method="POST" class="space-y-4">
				<input type="hidden" name="token" value={data.setupToken} />
				<div class="space-y-2">
					<Label for="companyName">Company name</Label>
					<Input id="companyName" name="companyName" type="text" required placeholder="Acme Corp" />
				</div>

				<div class="space-y-2">
					<Label for="displayName">Display name</Label>
					<Input id="displayName" name="displayName" type="text" placeholder="Jane Smith" />
				</div>

				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input id="email" name="email" type="email" required placeholder="admin@example.com" />
				</div>

				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						placeholder="Min. 8 characters"
					/>
				</div>

				<div class="space-y-2">
					<Label for="confirm">Confirm Password</Label>
					<Input
						id="confirm"
						name="confirm"
						type="password"
						required
						placeholder="Repeat password"
					/>
				</div>

				<Button type="submit" class="w-full">Create Account</Button>
			</form>
		{/if}

		{#if proxyOnly}
			{#if idpCanClaim}
				<div class="space-y-3">
					<p class="text-muted-foreground text-sm">
						This deployment authenticates via your upstream proxy (forward-auth). Continue through
						the proxy {data.pinned ? 'with the email below' : 'from this browser'}: that visit is
						granted instance admin.
					</p>
					{#if data.bootstrapEmail}
						<p class="text-sm">
							Expected email: <code class="bg-muted rounded-sm px-1 py-0.5"
								>{data.bootstrapEmail}</code
							>
						</p>
					{/if}
					<a href="/" class="block">
						<Button type="button" variant="outline" class="w-full">Continue</Button>
					</a>
				</div>
			{/if}
		{:else if !data.hasPasswordAuth && !data.hasEmailLink && data.oauthProviders.length === 0}
			<Callout tone="danger">
				No setup methods are configured. Configure password auth, email-link sign-in, or OAuth
				providers before bootstrapping the first admin.
			</Callout>
		{/if}
	</div>
</div>
