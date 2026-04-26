<script lang="ts">
	import { Button, Input, Label, Alert } from 'selva-shared';
	import { CircleAlert } from '@lucide/svelte';
	import type { PageData } from './$types';

	interface ActionData {
		error?: string;
	}

	interface Props {
		data: PageData;
		form?: ActionData;
	}

	let { data, form }: Props = $props();
</script>

<svelte:head>
	<title>Accept invite - Selva Compute</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		{#if !data.ok}
			<div class="space-y-1 text-center">
				<h2 class="text-foreground text-2xl font-bold tracking-tight">Invite unavailable</h2>
				<p class="text-muted-foreground text-sm">{data.reason}</p>
			</div>
			<div class="text-center">
				<a href="/login" class="text-primary text-sm underline">Go to login</a>
			</div>
		{:else}
			<div class="space-y-1 text-center">
				<h2 class="text-foreground text-2xl font-bold tracking-tight">Join {data.orgName}</h2>
				<p class="text-muted-foreground text-sm">
					You were invited as <span class="font-medium">{data.email}</span>. Set a password to
					finish creating your account.
				</p>
			</div>

			<form method="POST" class="space-y-4">
				<input type="hidden" name="token" value={data.token} />

				{#if form?.error}
					<Alert.Root variant="destructive">
						<CircleAlert />
						<Alert.Description>{form.error}</Alert.Description>
					</Alert.Root>
				{/if}

				<div class="space-y-2">
					<Label for="displayName"
						>Display name <span class="text-muted-foreground">(optional)</span></Label
					>
					<Input id="displayName" name="displayName" type="text" placeholder="Your name" />
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
					<Label for="confirm">Confirm password</Label>
					<Input
						id="confirm"
						name="confirm"
						type="password"
						required
						placeholder="Repeat password"
					/>
				</div>

				<Button type="submit" class="w-full">Create account</Button>
			</form>
		{/if}
	</div>
</div>
