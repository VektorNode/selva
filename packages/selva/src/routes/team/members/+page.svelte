<script lang="ts">
	import {
		Button,
		Card,
		Input,
		toast,
		SectionHeader,
		EmptyState,
		Pagination,
		ConfirmDialog
	} from '@selvajs/ui';
	import { Mail, Trash2, Copy, X, UserPlus, Send, Search } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { Invite, OrgPermission, OrgRole } from '@selvajs/platform';
	import {
		ALL_ORG_PERMISSIONS,
		MEMBER_ASSIGNABLE_PERMISSIONS,
		OWNER_ADMIN_ONLY_PERMISSIONS
	} from '@selvajs/platform';
	import type { MemberRow } from './+page.server';
	import { removalBlockReason } from './removal-gate';
	import UserRowIdentity from '$lib/components/UserRowIdentity.svelte';
	import { PERMISSION_LABELS, ROLE_TONE, ORG_ROLES } from '$lib/permission-labels';

	interface PageData {
		members: MemberRow[];
		invites: Invite[];
		orgId: string | null;
		actorRole: OrgRole | null;
		actorUserId: string;
		/** SMTP is set up, so minting an invite also mails the link. */
		mailConfigured: boolean;
	}
	let { data }: { data: PageData } = $props();

	// Per spec §3: only `owner` can change roles; `owner`/`admin` can grant
	// `manage_definitions`/`manage_projects` to a `member`. Server-side
	// `/api/v1/orgs/[orgId]/members/[userId]` PATCH is the load-bearing check.
	const isOwner = $derived(data.actorRole === 'owner');
	const isOwnerOrAdmin = $derived(data.actorRole === 'owner' || data.actorRole === 'admin');
	const ownerCount = $derived(data.members.filter((m) => m.role === 'owner').length);

	let savingId = $state<string | null>(null);

	async function patchMember(
		userId: string,
		patch: { role?: OrgRole; permissions?: OrgPermission[] }
	) {
		if (!data.orgId) return;
		savingId = userId;
		try {
			const res = await fetch(`/api/v1/orgs/${data.orgId}/members/${userId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (res.ok) {
				toast.success('Member updated');
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Could not update member');
			}
		} catch {
			toast.error('Could not update member');
		} finally {
			savingId = null;
		}
	}

	function changeRole(member: MemberRow, role: OrgRole) {
		if (member.role === role) return;
		patchMember(member.userId, { role });
	}

	function toggleMemberPermission(member: MemberRow, p: OrgPermission, checked: boolean) {
		const next = checked
			? Array.from(new Set([...member.permissions, p]))
			: member.permissions.filter((x) => x !== p);
		patchMember(member.userId, { permissions: next });
	}

	// Client-side over the loaded roster — the org member list is bounded and
	// already fully in `data.members`.
	let query = $state('');
	let roleFilter = $state<OrgRole | 'all'>('all');

	const filtersActive = $derived(query.trim() !== '' || roleFilter !== 'all');

	const visibleMembers = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return data.members.filter(
			(m) =>
				(needle === '' ||
					[m.displayName, m.email, m.userId].some((f) => f?.toLowerCase().includes(needle))) &&
				(roleFilter === 'all' || m.role === roleFilter)
		);
	});

	const PER_PAGE = 25;
	let page = $state(1);

	// Changing a filter re-slices from the top: staying on page 4 after a search
	// that matches three people shows an empty list.
	const filterKey = $derived(`${query} ${roleFilter}`);
	$effect(() => {
		void filterKey;
		page = 1;
	});

	const pagedMembers = $derived(visibleMembers.slice((page - 1) * PER_PAGE, page * PER_PAGE));

	function clearFilters() {
		query = '';
		roleFilter = 'all';
	}

	// Mirrors the invite route's owner-only gate: an admin who could mint an
	// `owner` invite would be able to accept it and then evict the founder.
	const invitableRoles = $derived(isOwner ? ORG_ROLES : ORG_ROLES.filter((r) => r !== 'owner'));

	// Invite form
	let showInviteForm = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<OrgRole>('member');
	let invitePermissions = $state<OrgPermission[]>([]);
	let creatingInvite = $state(false);
	let lastInviteLink = $state<string | null>(null);
	let lastInviteEmail = $state('');
	let lastDelivery = $state<InviteDelivery | null>(null);
	let revokingId = $state<string | null>(null);
	let resendingId = $state<string | null>(null);

	type InviteDelivery = 'sent' | 'not-configured' | 'failed';
	interface CreatedInvite {
		acceptUrl: string;
		delivery: InviteDelivery;
	}

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
			const res = await fetch(`/api/v1/orgs/${data.orgId}/invites`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: inviteEmail,
					orgRole: inviteRole,
					permissions: invitePermissions
				})
			});
			if (res.ok) {
				const { acceptUrl, delivery } = (await res.json()) as CreatedInvite;
				lastInviteLink = acceptUrl;
				lastDelivery = delivery;
				lastInviteEmail = inviteEmail;
				toast.success(
					delivery === 'sent'
						? `Invite sent to ${inviteEmail}`
						: `Invite created for ${inviteEmail}`
				);
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

	let removingId = $state<string | null>(null);
	let confirmingRemove = $state<MemberRow | null>(null);
	let confirmingResend = $state<Invite | null>(null);
	let confirmingRevoke = $state<Invite | null>(null);
	let showRemoveConfirm = $state(false);
	let showResendConfirm = $state(false);
	let showRevokeConfirm = $state(false);

	const blockReasonFor = (member: MemberRow) =>
		removalBlockReason({
			target: member,
			actorUserId: data.actorUserId,
			actorRole: data.actorRole,
			ownerCount
		});

	// Removal proceeds even when it orphans projects (§10) — the server reports
	// them rather than blocking, so the warning belongs here, before the fact.
	async function removeMember(member: MemberRow) {
		const who = member.email ?? member.displayName ?? member.userId;
		removingId = member.userId;
		try {
			const res = await fetch(`/api/v1/orgs/${data.orgId}/members/${member.userId}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				toast.success(`${who} removed from the organization`);
				showRemoveConfirm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Could not remove member');
			}
		} catch {
			toast.error('Could not remove member');
		} finally {
			removingId = null;
		}
	}

	// Resend replaces the invite rather than re-reading it: the raw token is
	// never stored, so the server mints a new one and revokes the old row. Any
	// link already sent stops working.
	async function resendInvite(invite: Invite) {
		resendingId = invite.id;
		try {
			const res = await fetch(`/api/v1/orgs/${data.orgId}/invites/${invite.id}/resend`, {
				method: 'POST'
			});
			if (res.ok) {
				const { acceptUrl, delivery } = (await res.json()) as CreatedInvite;
				lastInviteLink = acceptUrl;
				lastDelivery = delivery;
				lastInviteEmail = invite.email;
				toast.success(
					delivery === 'sent' ? `Invite resent to ${invite.email}` : 'New invite link issued'
				);
				showResendConfirm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Could not resend invite');
			}
		} catch {
			toast.error('Could not resend invite');
		} finally {
			resendingId = null;
		}
	}

	async function revokeInvite(id: string) {
		revokingId = id;
		try {
			const res = await fetch(`/api/v1/orgs/${data.orgId}/invites/${id}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success('Invite revoked');
				showRevokeConfirm = false;
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
	<title>Team · Members &amp; roles</title>
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
							{#if data.mailConfigured}
								Selva emails the invite link to this address. The invitee sets their own credentials
								when they open it.
							{:else}
								You'll get a link to send yourself — set <span class="font-mono">SMTP_HOST</span> to have
								Selva email invites directly. The invitee sets their own credentials when they open the
								link.
							{/if}
						</p>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<Input type="email" placeholder="Email" bind:value={inviteEmail} />
						<select
							bind:value={inviteRole}
							class="border-input bg-background h-9 rounded-md border px-3 text-sm"
						>
							{#each invitableRoles as role (role)}
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
			{@const sent = lastDelivery === 'sent'}
			<div
				class={`flex items-start gap-3 rounded-lg border p-4 ${
					lastDelivery === 'failed'
						? 'border-destructive/30 bg-destructive/5'
						: 'border-success/30 bg-success/5'
				}`}
			>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">
						{#if sent}
							Invite emailed to {lastInviteEmail}
						{:else if lastDelivery === 'failed'}
							Invite created, but the email could not be sent
						{:else}
							Invite ready — copy the link and share it
						{/if}
					</p>
					{#if lastDelivery === 'failed'}
						<p class="text-muted-foreground mt-1 text-xs">
							Check the server logs and your SMTP settings. Send this link manually in the meantime.
						</p>
					{:else if sent}
						<p class="text-muted-foreground mt-1 text-xs">
							Keep this link as a backup in case the mail does not arrive — it is shown only once.
						</p>
					{/if}
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

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm font-medium">
					Members
					<span class="text-muted-foreground ml-1 font-normal">({data.members.length})</span>
				</Card.Title>
				<Card.Description>
					Roles and per-member permissions.{isOwner
						? ' You can change roles and permissions.'
						: isOwnerOrAdmin
							? ' You can grant member permissions; only the owner can change roles.'
							: ''}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.members.length === 0}
					<EmptyState
						icon={UserPlus}
						title="No members yet"
						description="Invite someone to get started."
					/>
				{:else}
					{#if data.members.length > 5}
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
							<div class="relative flex-1">
								<Search
									class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
								/>
								<Input
									type="search"
									placeholder="Search name or email"
									bind:value={query}
									class="pl-9"
								/>
							</div>
							<select
								bind:value={roleFilter}
								aria-label="Filter by role"
								class="border-input bg-background h-9 rounded-md border px-3 text-sm"
							>
								<option value="all">All roles</option>
								{#each ORG_ROLES as role (role)}
									<option value={role}>{role}</option>
								{/each}
							</select>
							{#if filtersActive}
								<Button variant="ghost" size="sm" onclick={clearFilters}>
									<X class="mr-1.5 h-3.5 w-3.5" />
									Clear
								</Button>
							{/if}
						</div>
					{/if}

					{#if visibleMembers.length === 0}
						<EmptyState
							title="No matching members"
							description="Adjust or clear the filters above."
						/>
					{:else}
						<div class="divide-y rounded-lg border">
							{#each pagedMembers as member (member.userId)}
								{@const isSelf = member.userId === data.actorUserId}
								{@const isSoleOwner = member.role === 'owner' && ownerCount === 1}
								{@const canEditRole = isOwner && !isSelf && !isSoleOwner}
								{@const canEditPermissions = isOwnerOrAdmin && member.role === 'member'}
								{@const blockReason = blockReasonFor(member)}
								<div class="px-4 py-3">
									<div class="flex items-start justify-between gap-4">
										<UserRowIdentity
											user={member}
											id={member.userId}
											role={member.role}
											lastLoginAt={member.lastLoginAt}
											subtitle={`Joined ${new Date(member.joinedAt).toLocaleDateString()}`}
										>
											{#snippet roleBadge()}
												{#if canEditRole}
													<select
														value={member.role}
														disabled={savingId === member.userId}
														onchange={(e) =>
															changeRole(member, (e.target as HTMLSelectElement).value as OrgRole)}
														class={`border-input bg-background h-6 rounded-md border px-1.5 font-mono text-[10px] tracking-wide uppercase ${ROLE_TONE[member.role]}`}
													>
														{#each ORG_ROLES as role (role)}
															<option value={role}>{role}</option>
														{/each}
													</select>
												{:else}
													<span
														class={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${ROLE_TONE[member.role]}`}
														title={isSoleOwner
															? 'Sole owner — promote another member to owner before changing this role.'
															: isSelf
																? 'You cannot change your own role.'
																: undefined}
													>
														{member.role}
													</span>
												{/if}
											{/snippet}
										</UserRowIdentity>
										<Button
											size="sm"
											variant="ghost"
											disabled={removingId === member.userId || !!blockReason}
											onclick={() => {
												confirmingRemove = member;
												showRemoveConfirm = true;
											}}
											title={blockReason ?? 'Remove from organization'}
											class="text-destructive hover:text-destructive h-8 w-8 shrink-0 p-0"
										>
											<Trash2 class="h-4 w-4" />
										</Button>
									</div>
									{#if member.role === 'member'}
										<div class="mt-2 flex flex-wrap gap-3">
											{#each MEMBER_ASSIGNABLE_PERMISSIONS as p (p)}
												{@const has = member.permissions.includes(p)}
												{#if canEditPermissions}
													<label class="flex cursor-pointer items-center gap-1.5 text-xs">
														<input
															type="checkbox"
															checked={has}
															disabled={savingId === member.userId}
															onchange={(e) =>
																toggleMemberPermission(
																	member,
																	p,
																	(e.target as HTMLInputElement).checked
																)}
														/>
														{PERMISSION_LABELS[p] ?? p}
													</label>
												{:else if has}
													<span
														class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10px]"
													>
														{PERMISSION_LABELS[p] ?? p}
													</span>
												{/if}
											{/each}
										</div>
									{:else if OWNER_ADMIN_ONLY_PERMISSIONS.length > 0}
										<p class="text-muted-foreground mt-2 text-xs">
											{member.role === 'owner' ? 'Owners' : 'Admins'} hold all organization permissions
											by default.
										</p>
									{/if}
								</div>
							{/each}
						</div>
						<Pagination
							bind:page
							total={visibleMembers.length}
							perPage={PER_PAGE}
							label="members"
						/>
					{/if}
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
								{#if !invite.acceptedAt}
									<div class="flex shrink-0 items-center gap-1">
										<!-- Expired invites can be resent too — that is the whole point of the
										     button, since the link is unrecoverable once minted. -->
										<Button
											size="sm"
											variant="ghost"
											disabled={resendingId === invite.id}
											onclick={() => {
												confirmingResend = invite;
												showResendConfirm = true;
											}}
											title={data.mailConfigured
												? 'Email a fresh link (the current one stops working)'
												: 'Issue a fresh link (the current one stops working)'}
										>
											<Send class="mr-1.5 h-3.5 w-3.5" />
											{resendingId === invite.id ? 'Sending…' : 'Resend'}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={revokingId === invite.id}
											onclick={() => {
												confirmingRevoke = invite;
												showRevokeConfirm = true;
											}}
											class="text-destructive hover:text-destructive"
										>
											<Trash2 class="h-4 w-4" />
										</Button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={showRemoveConfirm}
	title="Remove member?"
	description={confirmingRemove
		? `Remove "${confirmingRemove.email ?? confirmingRemove.displayName ?? confirmingRemove.userId}" from this organization? They lose access to every project in it, and any pending invites to their email are revoked. Projects they solely own are left without an owner and can be adopted from Team → Reclaim.`
		: undefined}
	confirmLabel="Remove"
	pendingLabel="Removing…"
	variant="destructive"
	onConfirm={() => {
		if (confirmingRemove) return removeMember(confirmingRemove);
	}}
/>

<ConfirmDialog
	bind:open={showResendConfirm}
	title="Resend invite?"
	description={confirmingResend
		? `Resend the invite for "${confirmingResend.email}"? A new link is issued and the previous one stops working.`
		: undefined}
	confirmLabel="Resend"
	pendingLabel="Sending…"
	onConfirm={() => {
		if (confirmingResend) return resendInvite(confirmingResend);
	}}
/>

<ConfirmDialog
	bind:open={showRevokeConfirm}
	title="Revoke invite?"
	description={confirmingRevoke ? `Revoke invite for "${confirmingRevoke.email}"?` : undefined}
	confirmLabel="Revoke"
	pendingLabel="Revoking…"
	variant="destructive"
	onConfirm={() => {
		if (confirmingRevoke) return revokeInvite(confirmingRevoke.id);
	}}
/>
