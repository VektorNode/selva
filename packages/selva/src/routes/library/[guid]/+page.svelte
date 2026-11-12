<script lang="ts">
	import type { PageProps } from './$types';
	import { ComputeApp } from '@selvajs/ui';
	import { createComputeFetchSolveFn, createSolveEventStream } from '@selvajs/solve/client';
	import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';
	import ServerFooter from '#lib/components/ServerFooter.svelte';
	import UserChip from '#lib/components/UserChip.svelte';
	import MainNav from '#lib/components/MainNav.svelte';
	import SettingsMenu from '#lib/components/SettingsMenu.svelte';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	let { data }: PageProps = $props();

	// Reachable anonymously through a share token, so the app nav is gated on a real session.
	const pageData = $derived(
		page.data as {
			user?: { platformPermissions?: PlatformPermission[] } | null;
			ctx?: { orgPermissions?: OrgPermission[]; mayHoldApiTokens?: boolean } | null;
			branding?: { name: string };
		}
	);
	const isAuthed = $derived(!!pageData.user);

	function shouldShowViewer(): boolean {
		return Boolean(data.schema.viewerOptions?.enableRemote);
	}

	// One SSE stream per tab; the solve fn names it so the server routes each solve's events here.
	// Built only for a viewer solving with their own session. The stream connects as soon as it
	// exists, so an anonymous one would keep retrying a 401 with backoff, and a share-token solve
	// is never bound to a stream. Signing in or out is a navigation, so the initial value is the
	// only one this page sees.
	const liveEvents = untrack(() => isAuthed && !data.shareToken)
		? createSolveEventStream({
				endpoint: '/api/v1/solve-events',
				cancelEndpoint: (solveId) => `/api/v1/solve/${solveId}/cancel`
			})
		: null;
	$effect(() => () => liveEvents?.close());

	const onSolve = createComputeFetchSolveFn({
		endpoint: '/api/v1/compute',
		definitionUrl: () => data.ghDefinition,
		inputs: () => data.schema.inputs,
		outputs: () => data.schema.outputs,
		channel: () => (data.channel === 'draft' ? 'draft' : undefined),
		versionId: () => data.versionId,
		streamId: () => liveEvents?.streamId ?? null,
		bearerToken: () => data.shareToken,
		keepalive: true,
		meshes: shouldShowViewer()
			? { extract: (response, opts) => getThreeObjectsFromComputeResponse(response, opts) }
			: undefined,
		debug: true
	});
</script>

<ComputeApp
	schema={data.schema}
	{onSolve}
	definitionKey={data.currentDefinition}
	title={data.schema?.name || data.schema.description}
	logo={data.orgLogoUrl ?? undefined}
	showModeToggle={true}
	brandName={pageData.branding?.name}
	homeUrl="/"
	solveDeadlineMs={data.solveDeadlineMs}
	events={liveEvents ?? undefined}
	footerComponent={ServerFooter}
	footerComponentProps={() => ({ label: data.serverLabel })}
>
	{#snippet navItems()}
		{#if isAuthed}
			<MainNav />
		{/if}
	{/snippet}

	{#snippet headerRight()}
		{#if data.versionId}
			<span
				class="bg-warning/15 text-warning shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap uppercase"
			>
				v{data.versionNumber}<span class="hidden sm:inline"> preview</span>
			</span>
		{:else if data.channel === 'draft'}
			<span
				class="bg-warning/15 text-warning shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap uppercase"
			>
				Draft<span class="hidden sm:inline"> preview</span>
			</span>
		{/if}
		{#if isAuthed}
			<UserChip />
			<SettingsMenu
				platformPermissions={pageData.user?.platformPermissions ?? []}
				orgPermissions={pageData.ctx?.orgPermissions ?? []}
				mayHoldApiTokens={pageData.ctx?.mayHoldApiTokens}
			/>
		{/if}
	{/snippet}
</ComputeApp>
