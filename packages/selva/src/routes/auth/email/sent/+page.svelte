<script lang="ts">
	import { page } from '$app/state';
	import { Callout } from '@selvajs/ui';
	import { Mail } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Check your email - {page.data.branding.name}</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6 text-center">
		<div class="flex justify-center">
			<div class="bg-muted rounded-full p-4">
				<Mail class="text-foreground size-8" />
			</div>
		</div>
		<div class="space-y-2">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Check your email</h2>
			<p class="text-muted-foreground text-sm">
				We sent you a sign-in link. Click the link in the email to continue.
			</p>
		</div>
		<Callout tone="info">
			The link expires in a few minutes. If it doesn't arrive, check your spam folder or request a
			new one from the sign-in page.
		</Callout>
		<a class="text-muted-foreground hover:text-foreground text-sm underline" href="/login">
			Back to sign in
		</a>
	</div>
</div>
