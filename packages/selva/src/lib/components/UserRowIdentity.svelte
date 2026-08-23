<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { OrgRole } from '@selvajs/platform';
	import UserAvatar from './UserAvatar.svelte';
	import { primaryLabel, emailSubtitle } from '$lib/user-display';
	import { ROLE_TONE } from '$lib/permission-labels';

	interface Props {
		user: { displayName?: string | null; email?: string | null };
		id: string;
		role?: OrgRole;
		disabled?: boolean;
		/** Absent ⇒ provisioned but never authenticated. */
		lastLoginAt?: string;
		/** Second line under the name. Defaults to the user id. */
		subtitle?: string;
		/** Extra content under the subtitle — permission chips, joined date. */
		children?: Snippet;
		/** Replaces the static role badge, for surfaces that edit the role inline. */
		roleBadge?: Snippet;
	}

	let {
		user,
		id,
		role,
		disabled = false,
		lastLoginAt,
		subtitle,
		children,
		roleBadge
	}: Props = $props();

	const label = $derived(primaryLabel(user, id));
	const email = $derived(emailSubtitle(user));
	const displayLine = $derived(email ? `${label} · ${email}` : label);
</script>

<UserAvatar name={label} />

<div class="min-w-0 flex-1">
	<div class="flex items-center gap-2">
		<p class="truncate text-sm font-medium">{displayLine}</p>
		{#if roleBadge}
			{@render roleBadge()}
		{:else if role}
			<span
				class={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${ROLE_TONE[role]}`}
			>
				{role}
			</span>
		{/if}
		{#if disabled}
			<span
				class="border-border bg-muted text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
			>
				disabled
			</span>
		{:else if !lastLoginAt}
			<span
				class="rounded-full border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400"
				title="Provisioned but has never signed in. Permissions take effect on first login."
			>
				never signed in
			</span>
		{/if}
	</div>
	<p class="text-muted-foreground truncate font-mono text-xs">{subtitle ?? id}</p>
	{@render children?.()}
</div>
