<script lang="ts">
	import { Button, Card, Input, toast, SectionHeader } from '@selvajs/ui';
	import { Mail, Trash2, Copy, X, UserPlus } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { Invite, OrgPermission, OrgRole } from '@selvajs/platform';
	import { ALL_ORG_PERMISSIONS, OWNER_ADMIN_ONLY_PERMISSIONS } from '@selvajs/platform';
	import type { MemberRow } from './+page.server';

	interface PageData {
		members: MemberRow[];
		invites: Invite[];
		orgId: string | null;
	}
	let { data }: { data: PageData } = $props();

	const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member'];

	const PERMISSION_LABELS: Record<OrgPermission, string> = {
		manage_org_members: 'Manage members',
		manage_org_compute: 'Manage compute',
		manage_definitions: 'Manage definitions',
		manage_projects: 'Manage projects'
	};

	const ROLE_TONE: Record<OrgRole, string> = {
		owner: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
		admin: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
		member: 'border-border text-muted-foreground'
	};

	// Invite form
	let showInviteForm = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<OrgRole>('member');
	let invitePermissions = $state<OrgPermission[]>([]);
	let creatingInvite = $state(false);
	let lastInviteLink = $state<string | null>(null);
	let revokingId = $state<string | null>(null);

	const invitePermissionOptions = $derived<OrgPermission[]>(
		inviteRole === 'member'
			? ALL_ORG_PERMISSIONS.filter(
					(p) => !(OWNER_ADMIN_ONLY_PERMISSIONS as readonly OrgPermission[]).includes(p)
				)
			: [...ALL_ORG_PERMISSIONS]
	);

	function toggleInvitePermission(p: OrgPermission, checked: boolean) {
		invitePermissions = checked
			? [...invitePermissions, p]
			: invitePermissions.filter((x) => x !== p);
	}

	async function createInvite() {
		creatingInvite = true;
		try {
			const res = await fetch('/api/invites', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: inviteEmail,
					orgRole: inviteRole,
					permissions: invitePermissions
				})
			});
			if (res.ok) {
				const { acceptUrl } = (await res.json()) as { acceptUrl: string };
				lastInviteLink = acceptUrl;
				toast.success(`Invite created for ${inviteEmail}`);
				inviteEmail = '';
				inviteRole = 'member';
				invitePermissions = [];
				showInviteForm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				toast.error(err.message || err.error || 'Failed to create invite');
			}
		} catch {
			toast.error('Failed to create invite');
		} finally {
			creatingInvite = false;
		}
	}

	async function revokeInvite(id: string, email: string) {
		if (!confirm(`Revoke invite for "${email}"?`)) return;
		revokingId = id;
		try {
			const res = await fetch(`/api/invites/${id}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success('Invite revoked');
				await invalidateAll();
			} else {
				toast.error('Failed to revoke invite');
			}
		} catch {
			toast.error('Failed to revoke invite');
		} finally {
			revokingId = null;
		}
	}
</script>

<svelte:head>
	<title>Team · Members</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Members & roles"
		description={data.orgId
			? `${data.members.length} member${data.members.length === 1 ? '' : 's'} in this organization.`
			: 'No active organization. Switch orgs from the user menu.'}
	>
		{#snippet actions()}
			{#if data.orgId}
				<Button
					onclick={() => (showInviteForm = !showInviteForm)}
					variant={showInviteForm ? 'outline' : 'default'}
				>
					<Mail class="mr-2 h-4 w-4" />
					Invite member
				</Button>
			{/if}
		{/snippet}
	</SectionHeader>

	{#if data.orgId}
		<!-- Invite form -->
		{#if showInviteForm}
			<Card.Root>
				<Card.Content class="space-y-3 pt-6">
					<div>
						<p class="text-sm font-medium">Invite member</p>
						<p class="text-muted-foreground text-xs">
							The invitee sets their own credentials when they open the link. No password leaves
							your machine.
						</p>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<Input type="email" placeholder="Email" bind:value={inviteEmail} />
						<select
							bind:value={inviteRole}
							class="border-input bg-background h-9 rounded-md border px-3 text-sm"
						>
							{#each ORG_ROLES as role (role)}
								<option value={role}>{role}</option>
							{/each}
						</select>
					</div>
					<div>
						<p class="mb-2 text-xs font-medium">Permissions</p>
						{#if inviteRole !== 'member'}
							<p class="text-muted-foreground mb-2 text-xs">
								{inviteRole === 'owner' ? 'Owners' : 'Admins'} automatically receive all organization
								permissions. Pick <span class="font-mono">member</span> to grant a custom subset.
							</p>
						{/if}
						<div class="flex flex-wrap gap-3">
							{#each invitePermissionOptions as p (p)}
								{@const roleLocked = inviteRole !== 'member'}
								<label
									class={`flex items-center gap-1.5 text-xs ${roleLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
								>
									<input
										type="checkbox"
										checked={roleLocked || invitePermissions.includes(p)}
										disabled={roleLocked}
										onchange={(e) =>
											toggleInvitePermission(p, (e.target as HTMLInputElement).checked)}
									/>
									{PERMISSION_LABELS[p]}
								</label>
							{/each}
						</div>
					</div>
					<div class="flex gap-2">
						<Button onclick={createInvite} disabled={creatingInvite || !inviteEmail}>
							{creatingInvite ? 'Creating…' : 'Create invite'}
						</Button>
						<Button variant="outline" onclick={() => (showInviteForm = false)}>Cancel</Button>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if lastInviteLink}
			<div class="border-success/30 bg-success/5 flex items-start gap-3 rounded-lg border p-4">
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Invite ready — copy the link and share it</p>
					<p class="text-muted-foreground mt-1 truncate font-mono text-xs">{lastInviteLink}</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					onclick={async () => {
						try {
							await navigator.clipboard.writeText(lastInviteLink!);
							toast.success('Invite link copied');
						} catch {
							toast.error('Could not copy to clipboard');
						}
					}}
				>
					<Copy class="mr-1.5 h-3.5 w-3.5" />
					Copy
				</Button>
				<Button size="sm" variant="ghost" onclick={() => (lastInviteLink = null)}>
					<X class="h-4 w-4" />
				</Button>
			</div>
		{/if}

		<!-- Roster -->
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm font-medium">Roster</Card.Title>
				<Card.Description>
					Roles and per-member permissions. Editing roles lands in a follow-up.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if data.members.length === 0}
					<div
						class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
					>
						<UserPlus class="text-muted-foreground mb-3 h-8 w-8" />
						<p class="text-sm font-medium">No members yet</p>
						<p class="text-muted-foreground mt-1 text-sm">Invite teammates to get started.</p>
					</div>
				{:else}
					<div class="divide-y rounded-lg border">
						{#each data.members as member (member.userId)}
							<div class="px-4 py-3">
								<div class="flex items-start justify-between gap-4">
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2">
											<p class="truncate text-sm font-medium">
												{member.email ?? member.displayName ?? member.userId}
											</p>
											<span
												class={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${ROLE_TONE[member.role]}`}
											>
												{member.role}
											</span>
										</div>
										<p class="text-muted-foreground text-xs">
											Joined {new Date(member.joinedAt).toLocaleDateString()}
										</p>
									</div>
								</div>
								{#if member.role === 'member' && member.permissions.length > 0}
									<div class="mt-2 flex flex-wrap gap-1.5">
										{#each member.permissions as p (p)}
											<span
												class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10px]"
											>
												{PERMISSION_LABELS[p] ?? p}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Pending invites -->
		{#if data.invites.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium">Invites</Card.Title>
					<Card.Description>
						{data.invites.filter((i) => !i.acceptedAt).length} pending, {data.invites.filter(
							(i) => i.acceptedAt
						).length} accepted
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="divide-y rounded-lg border">
						{#each data.invites as invite (invite.id)}
							{@const expired = Date.parse(invite.expiresAt) <= Date.now()}
							{@const status = invite.acceptedAt ? 'Accepted' : expired ? 'Expired' : 'Pending'}
							<div class="flex items-center justify-between gap-4 px-4 py-3">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{invite.email}</p>
									<p class="text-muted-foreground text-xs">
										{status} · {invite.orgRole} · expires {new Date(
											invite.expiresAt
										).toLocaleDateString()}
									</p>
								</div>
								{#if !invite.acceptedAt && !expired}
									<Button
										size="sm"
										variant="ghost"
										disabled={revokingId === invite.id}
										onclick={() => revokeInvite(invite.id, invite.email)}
										class="text-destructive hover:text-destructive"
									>
										<Trash2 class="h-4 w-4" />
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
