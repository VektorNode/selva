<script lang="ts">
	import { Button, Input, Label, Alert } from 'selva-shared';
	import { CircleAlert } from '@lucide/svelte';

	interface ActionData {
		error?: string;
	}

	interface Props {
		form?: ActionData;
	}

	let { form }: Props = $props();
</script>

<svelte:head>
	<title>Setup - Selva Compute</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-1 text-center">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Create Admin Account</h2>
			<p class="text-muted-foreground text-sm">
				No users found. Set up your platform admin account to get started.
			</p>
		</div>

		<form method="POST" class="space-y-4">
			{#if form?.error}
				<Alert.Root variant="destructive">
					<CircleAlert />
					<Alert.Description>{form.error}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="space-y-2">
				<Label for="companyName">Company name</Label>
				<Input
					id="companyName"
					name="companyName"
					type="text"
					required
					placeholder="Acme Corp"
				/>
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
				<Input id="confirm" name="confirm" type="password" required placeholder="Repeat password" />
			</div>

			<Button type="submit" class="w-full">Create Account</Button>
		</form>
	</div>
</div>
