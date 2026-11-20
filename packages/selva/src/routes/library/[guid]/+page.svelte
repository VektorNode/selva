<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidate } from '$app/navigation';
	import { ComputeApp, toast } from '@selvajs/ui';
	import {
		SAVED_VALUES_DEPENDENCY,
		SAVED_VALUES_RECHECK_MS,
		lateSavedValues
	} from '#lib/saved-values.js';
	import { createComputeFetchSolveFn, createSolveEventStream } from '@selvajs/solve/client';
	import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';
	import ServerFooter from '#lib/components/ServerFooter.svelte';
	import UserChip from '#lib/components/UserChip.svelte';
	import MainNav from '#lib/components/MainNav.svelte';
	import SettingsMenu from '#lib/components/SettingsMenu.svelte';
	import { loadRhino } from '#lib/load-rhino.js';
	import { page } from '$app/state';
	import { untrack, type ComponentProps } from 'svelte';
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
		respondAsync: true,
		meshes: shouldShowViewer()
			? { extract: (response, opts) => getThreeObjectsFromComputeResponse(response, opts) }
			: undefined,
		debug: true
	});

	// A repeated load returns an equal schema as a new object. The form keeps the one it has
	// until the content changes, or every recheck would re-render it under the user's hands.
	let held: { json: string; schema: typeof data.schema } | undefined;
	const formSchema = $derived.by(() => {
		const json = JSON.stringify(data.schema);
		if (held?.json !== json) held = { json, schema: data.schema };
		return held.schema;
	});

	type AppApi = Parameters<NonNullable<ComponentProps<typeof ComputeApp>['onReady']>>[0];
	let app: AppApi | undefined;
	function handleReady(api: AppApi) {
		app = api;
	}
	const SAVED_VALUES_TOAST = 'saved-values';
	// A solve started now would run on the stored defaults, and the saved values would then
	// replace them under a result that no longer matches the form.
	// Set from the load, not only by the effect below, so the app's first render already holds.
	let readingSavedValues = $state(untrack(() => data.defaultsPending));

	// Per definition and version, not per mount: navigating between two definitions keeps this
	// component.
	$effect(() => {
		void [data.currentDefinition, data.channel, data.versionId];
		return untrack(watchSavedValues);
	});

	/** Says the form shows stored defaults, and repeats the load until the saved values arrive. */
	function watchSavedValues(): (() => void) | undefined {
		if (!data.defaultsPending) return;
		const before = formSchema;
		let attempt = 0;
		let timer: ReturnType<typeof setTimeout>;
		let stopped = false;
		readingSavedValues = true;

		async function recheck() {
			// `keepState`: an open dialog held in `page.state` must survive the recheck. A failed
			// recheck counts as "not yet".
			await invalidate(SAVED_VALUES_DEPENDENCY, true).catch(() => {});
			if (stopped) return;

			if (!data.defaultsPending) {
				readingSavedValues = false;
				const late = app ? lateSavedValues(before, data.schema, app.getSession().values) : {};
				if (Object.keys(late).length === 0) {
					toast.dismiss(SAVED_VALUES_TOAST);
					return;
				}
				app?.loadValues(late);
				toast.success('Saved values loaded', {
					id: SAVED_VALUES_TOAST,
					description: 'Inputs you had not changed were updated.',
					duration: 5000
				});
				return;
			}

			attempt += 1;
			if (attempt >= SAVED_VALUES_RECHECK_MS.length) {
				readingSavedValues = false;
				toast.warning('Saved values not loaded', {
					id: SAVED_VALUES_TOAST,
					description:
						'Rhino.Compute did not answer in time. The form shows stored defaults. Reload the page to try again.',
					duration: Infinity
				});
				return;
			}
			timer = setTimeout(recheck, SAVED_VALUES_RECHECK_MS[attempt]);
		}
		timer = setTimeout(recheck, SAVED_VALUES_RECHECK_MS[0]);

		return () => {
			stopped = true;
			readingSavedValues = false;
			clearTimeout(timer);
			toast.dismiss(SAVED_VALUES_TOAST);
		};
	}
</script>

<ComputeApp
	schema={formSchema}
	onReady={handleReady}
	{onSolve}
	definitionKey={data.currentDefinition}
	title={data.schema?.name || data.schema.description}
	logo={data.orgLogoUrl ?? undefined}
	showModeToggle={true}
	brandName={pageData.branding?.name}
	homeUrl="/"
	solveDeadlineMs={data.solveDeadlineMs}
	solveHold={readingSavedValues ? 'Reading saved values…' : undefined}
	events={liveEvents ?? undefined}
	{loadRhino}
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
