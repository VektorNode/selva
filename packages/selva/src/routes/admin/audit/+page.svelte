<script lang="ts">
	import { Badge, Button, Card, Input, Label, SectionHeader, Select } from '@selvajs/ui';
	import { ChevronDown, ChevronRight, ScrollText, ShieldCheck, X } from '@lucide/svelte';
	import type { DomainEventType } from '@selvajs/platform';
	import type { AuditPageData, EnrichedAuditRow } from './+page.server';

	interface Props {
		data: AuditPageData;
	}
	let { data }: Props = $props();

	// Pretty labels for each event type. Keep in sync with the union in
	// platform/src/events/interface.ts.
	const TYPE_LABELS: Record<DomainEventType, string> = {
		'org.created': 'Org · created',
		'org.deleted': 'Org · deleted',
		'org_member.added': 'Org member · added',
		'org_member.removed': 'Org member · removed',
		'org_member.role_changed': 'Org member · role changed',
		'org_member.permissions_changed': 'Org member · permissions changed',
		'project.created': 'Project · created',
		'project.deleted': 'Project · deleted',
		'project_member.added': 'Project member · added',
		'project_member.removed': 'Project member · removed',
		'project_member.role_changed': 'Project member · role changed',
		'definition.created': 'Definition · created',
		'definition.deleted': 'Definition · deleted',
		'definition.published': 'Definition · published',
		'definition_version.created': 'Version · created',
		'definition_version.deleted': 'Version · deleted',
		'share_link.minted': 'Share link · minted',
		'share_link.revoked': 'Share link · revoked',
		'invite.created': 'Invite · created',
		'invite.accepted': 'Invite · accepted',
		'invite.revoked': 'Invite · revoked',
		'system.update.started': 'System update · started',
		'system.update.finished': 'System update · finished',
		'system.update.rolled_back': 'System update · rolled back',
		'system.update.failed': 'System update · FAILED'
	};

	const TARGET_KIND_LABEL: Record<string, string> = {
		org: 'Org',
		project: 'Project',
		definition: 'Definition',
		definition_version: 'Version',
		share_link: 'Share link',
		invite: 'Invite',
		user: 'User'
	};

	function toDateInput(iso: string): string {
		if (!iso) return '';
		// Server may have expanded `YYYY-MM-DD` to a full ISO; collapse back.
		const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
		return m ? m[1] : '';
	}

	// Single-select for v1 — `searchParams.type` carries one value at a time.
	// `__all__` sentinel = no `?type=` filter on submit.
	const ALL_TYPES_VALUE = '__all__';
	type TypeFilterValue = DomainEventType | typeof ALL_TYPES_VALUE;

	// The Select needs a writable, locally-mutable model so the user can change
	// it before submitting. Initialise from `data` once; subsequent navigations
	// reload the page and remount this component, so a stale capture isn't a
	// concern in practice. Suppression keeps Svelte's static analysis quiet.
	// svelte-ignore state_referenced_locally
	let typeValue = $state<TypeFilterValue>(
		(data.filters.types[0] as DomainEventType | undefined) ?? ALL_TYPES_VALUE
	);

	const expanded = $state<Record<string, boolean>>({});
	function toggle(id: string) {
		expanded[id] = !expanded[id];
	}

	const nextPageHref = $derived.by(() => {
		if (!data.nextCursor) return '';
		const parts: string[] = [];
		const push = (k: string, v: string) =>
			parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
		for (const t of data.filters.types) push('type', t);
		if (data.filters.actorId) push('actor', data.filters.actorId);
		if (data.filters.sinceIso) push('since', toDateInput(data.filters.sinceIso));
		if (data.filters.untilIso) push('until', toDateInput(data.filters.untilIso));
		push('cursor', JSON.stringify(data.nextCursor));
		return `?${parts.join('&')}`;
	});

	function formatTimestamp(iso: string): string {
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}

	function shortId(id: string): string {
		if (id.length <= 8) return id;
		return id.slice(0, 8) + '…';
	}

	function targetLabel(row: EnrichedAuditRow): string {
		if (!row.target) return '—';
		const kind = TARGET_KIND_LABEL[row.target.kind] ?? row.target.kind;
		if (row.target.name) return `${kind}: ${row.target.name}`;
		return `${kind}: ${shortId(row.target.id)} (deleted)`;
	}
</script>

<svelte:head>
	<title>Admin · Audit log</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Audit log"
		description="Every domain event recorded on this instance — actor, type, target, timestamp."
	/>

	{#if !data.available}
		<Card.Root>
			<Card.Content class="pt-6">
				<div class="bg-muted/30 flex items-start gap-4 rounded-lg border p-5">
					<div class="bg-accent text-accent-foreground rounded-md p-2.5">
						<ShieldCheck class="h-4 w-4" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium">Audit log not available on this deployment</p>
						<p class="text-muted-foreground mt-1 text-sm">
							This provider doesn't support audit queries. To enable audit logs, switch to a data
							provider that supports <code class="bg-muted rounded px-1 py-0.5 font-mono text-xs"
								>auditQuery</code
							>
							by changing
							<code class="bg-muted rounded px-1 py-0.5 font-mono text-xs">SELVA_DATA_PROVIDER</code
							> in your .env.
						</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="pt-6">
				<form method="get" class="grid gap-4 md:grid-cols-[1fr_1fr_auto_auto_auto]">
					<div class="flex flex-col gap-1.5">
						<Label for="audit-type">Event type</Label>
						<Select.Root
							type="single"
							value={typeValue}
							onValueChange={(v) => (typeValue = (v as TypeFilterValue) ?? ALL_TYPES_VALUE)}
						>
							<Select.Trigger id="audit-type" class="h-9 text-sm">
								<span class="truncate">
									{typeValue === ALL_TYPES_VALUE
										? 'All event types'
										: (TYPE_LABELS[typeValue as DomainEventType] ?? typeValue)}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value={ALL_TYPES_VALUE} label="All event types" />
								{#each data.knownTypes as t (t)}
									<Select.Item value={t} label={TYPE_LABELS[t]} />
								{/each}
							</Select.Content>
						</Select.Root>
						<!-- Mirror the Select value into the form submission. Omitted when
							 "all types" so we don't send a `type=__all__` filter. -->
						{#if typeValue !== ALL_TYPES_VALUE}
							<input type="hidden" name="type" value={typeValue} />
						{/if}
					</div>

					<div class="flex flex-col gap-1.5">
						<Label for="audit-actor">Actor user ID</Label>
						<!-- Uncontrolled — the GET form submits the live DOM value. -->
						<Input
							id="audit-actor"
							name="actor"
							placeholder="User ID, or 'system'"
							defaultValue={data.filters.actorId}
							class="h-9 text-sm"
						/>
					</div>

					<div class="flex flex-col gap-1.5">
						<Label for="audit-since">From</Label>
						<Input
							id="audit-since"
							name="since"
							type="date"
							defaultValue={toDateInput(data.filters.sinceIso)}
							class="h-9 text-sm"
						/>
					</div>

					<div class="flex flex-col gap-1.5">
						<Label for="audit-until">To</Label>
						<Input
							id="audit-until"
							name="until"
							type="date"
							defaultValue={toDateInput(data.filters.untilIso)}
							class="h-9 text-sm"
						/>
					</div>

					<div class="flex items-end gap-2">
						<Button type="submit" class="h-9">Apply</Button>
						<Button type="button" variant="ghost" href="/admin/audit" class="h-9">
							<X class="h-4 w-4" />
							Reset
						</Button>
					</div>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm font-medium">
					Events
					<span class="text-muted-foreground ml-2 font-normal">
						{data.rows.length}
						{data.rows.length === 1 ? 'event' : 'events'}
					</span>
				</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if data.rows.length === 0}
					<div class="text-muted-foreground flex flex-col items-center gap-2 py-12 text-sm">
						<ScrollText class="h-8 w-8 opacity-40" />
						<p>No events match these filters.</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="text-muted-foreground border-b text-left text-xs uppercase">
								<tr>
									<th class="w-8 py-2"></th>
									<th class="py-2 pr-4">Time</th>
									<th class="py-2 pr-4">Type</th>
									<th class="py-2 pr-4">Actor</th>
									<th class="py-2 pr-4">Target</th>
								</tr>
							</thead>
							<tbody>
								{#each data.rows as row (row.id)}
									<tr class="hover:bg-muted/30 border-b">
										<td class="py-2">
											<button
												type="button"
												class="text-muted-foreground hover:text-foreground"
												aria-label={expanded[row.id] ? 'Collapse details' : 'Expand details'}
												onclick={() => toggle(row.id)}
											>
												{#if expanded[row.id]}
													<ChevronDown class="h-4 w-4" />
												{:else}
													<ChevronRight class="h-4 w-4" />
												{/if}
											</button>
										</td>
										<td class="py-2 pr-4 font-mono text-xs whitespace-nowrap">
											{formatTimestamp(row.occurredAt)}
										</td>
										<td class="py-2 pr-4">
											<Badge variant="outline" class="font-mono text-[10px]">
												{TYPE_LABELS[row.type] ?? row.type}
											</Badge>
										</td>
										<td class="py-2 pr-4">
											{#if row.actor.isSystem}
												<Badge variant="secondary">System</Badge>
											{:else if row.actor.name}
												<span>{row.actor.name}</span>
												<span class="text-muted-foreground ml-1 font-mono text-xs">
													{shortId(row.actor.id)}
												</span>
											{:else}
												<span class="text-muted-foreground italic">Deleted user</span>
												<span class="text-muted-foreground ml-1 font-mono text-xs">
													{shortId(row.actor.id)}
												</span>
											{/if}
										</td>
										<td class="py-2 pr-4">{targetLabel(row)}</td>
									</tr>
									{#if expanded[row.id]}
										<tr class="bg-muted/20 border-b">
											<td></td>
											<td colspan="4" class="py-2 pr-4">
												<pre
													class="text-muted-foreground max-w-full overflow-x-auto text-xs">{JSON.stringify(
														row.data,
														null,
														2
													)}</pre>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				{#if data.nextCursor}
					<div class="mt-4 flex justify-center">
						<Button variant="outline" href={nextPageHref} class="h-9">Load older</Button>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
