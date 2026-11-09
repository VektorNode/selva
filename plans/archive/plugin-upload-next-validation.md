# Validation: plugin-upload-next

Validates [plugin-upload-next.md](./plugin-upload-next.md) against the tree, with a security focus.
It was checked the same way as
[directory-offboarding-validation.md](./directory-offboarding-validation.md): a mechanical pass, a
code read, a cross-check of the proposals, and an independent hunt over the upload path that never
saw the plan, with every "reproduced" finding re-run by a second agent. The baseline was green.

**Not verified here:** nothing ran in Rhino, so the network traffic from a pasted key and an
end-to-end sign-in to a hostile origin are inferred, not observed. The Supabase insert policy was
read, not run against a live stack. Behaviour across several replicas (rate limit, idempotency) is
inferred from code.

## 1. Corrections

- **"`upload` covers `POST /projects`. The registry declares it `upload`": wrong as a design, and
  incomplete as a change.**
  - Every live `upload:*` key would gain project creation retroactively. That includes the plugin's
    30-day OAuth keys and Team keys of up to 180 days. Their owners approved "create definitions and
    new versions… It can't delete or share anything" (`oauth/authorize/+page.svelte:17`). A test
    pins the current refusal (`apiTokens.upload.test.ts:180`), and publish-from-plugin and
    signing-in-from-apps say `upload` can't create projects.
  - Changing the registry alone also does nothing: the route mount
    (`routes/api/v1/projects/+server.ts`) passes no `action`, so `actionForMethod` gives `write`.
  - Fix: a new scope action for creating projects, plus a matching OAuth scope the plugin requests.
    Old keys keep their meaning, and an older server ignores the new scope. Update the consent text,
    `describeApiScope` and the mint email in the same change.
- **"Visibility changes stay behind `PATCH`": the premise is wrong today.** `createProject` checks
  only `platform` visibility (`projects.ts:101`). A plain member with `manage_projects`, in a
  browser or with a `write:all` key, can create a `public` project with `autoJoinOnUpload: true`
  (201). `PATCH` to public is refused by `canChangeVisibilityToPublic` (`projects.ts:208`).
  _Reproduced._ This exists today for browser sessions as well; see section 3.
- **"`autoJoinOnUpload` gets a 403": refine.** An explicit `false` must not 403, because the plugin
  may send it.
- **`/me` gains `canCreateProjects`: gap.** `me.ts` has no org member row, and `canCreateProject`
  needs one. Put one helper in `@selvajs/server`, called by both `createProject` and `/me`, built
  from `canCreateProject` and the scope check. Return capabilities rather than permissions: `/me`
  returns the owner's `orgPermissions` without narrowing them, so a `read:all` key reports
  `manage_projects` (reproduced).
- **"A retry reuses the project": gap.** Only `PostMultipartAsync` sends an `Idempotency-Key`
  (`SelvaApiClient.cs:101-135`), and project creation is a JSON post. Server idempotency is
  in-process, keyed per token, and lasts five minutes. After that, or on another replica, a retry
  gets a 409 name conflict (`create-project.ts:80`). Fix: one `Idempotency-Key` per attempt, keep
  the created id, and treat a 409 on the plugin's own retry as "look it up by name".
- **"`/me` once on load and again on any 401": gap.** `/me` can also answer
  `403 API_TOKEN_HOLDER_REFUSED`, a `403 requiredScope` for a project-scoped key, or a 503 when
  delegated sessions are down. The plugin only reacts to a 401 with `invalid_token`, so a
  holder-refused key shows as signed in for good. `DELETE /me/token` returns 403 for that key as
  well, so Sign out can't revoke it. Fix: a three-way verdict keyed on the error code (valid,
  refused, invalid); show Upload only when valid; exempt `DELETE /me/token` from the holder check.
- **"Every builder sidebar panel edits the schema": partly.** Parameters edits it indirectly through
  callbacks. The conclusion, that the connection doesn't belong in the sidebar, stands.

## 2. Confirmed

- `SelvaAccountSection` is the dialog's first section, and the Upload button's `disabled` ignores
  sign-in state (`builder/+page.svelte:308`, `:339`).
- `Snapshot()` reads local state only. `getAccount` is sent only when the dialog opens
  (`selva-upload-core.ts:232`).
- `canCreateDefinitions` per project (`projects.ts:74`) and `canEdit` per definition
  (`definitions.ts:240`) exist.
- `narrowApiTokenContext` keeps the owner's org role and permissions and drops only platform ones,
  so `requireCanCreateProject` works for a token context. A project- or definition-scoped key is
  refused on a route with no scope target. `platform` visibility still needs `instance_admin`.
- The holder premise holds: an org with no projects fails `canCreateDefinitionInOrg`.
  `manage_api_tokens` is a platform permission that org owners don't get, so widening the holder
  rule is not moot for them.

## 3. New findings

### High

- **Project creation ignores the public-visibility gate** (`projects.ts:101`; neither store checks
  it either). A public commons project lets every org member, or with `ALLOW_CROSS_ORG_PUBLIC`
  every user on the instance, upload definitions that run on the org's Compute. _Reproduced._ Fix:
  one visibility gate in `@selvajs/server`, used by both create and `PATCH`. It's independent of
  this plan.

### Medium

- **A page can point the plugin at a hostile origin.** Any page holding the bridge secret can send
  `selvaConnect` with any origin, then `selvaSignIn`. A hostile authorization server can complete
  the flow without a click. Uploads then go there: the active origin is shared across the process,
  and `SelvaUploadRequest` carries no origin (`SelvaUploadCoordinator.cs:116`, `:279`). This needs
  the bridge secret, which in practice means XSS in plugin-ui. _Read-only._ Fix: echo `origin` and
  the token id from `SelvaTargets` into the upload request and refuse a mismatch; confirm a
  never-used origin in a native Rhino dialog.
- **A key pasted into the address field leaks.** `SelvaOrigin.TryNormalize` accepts `selva_…` as a
  host (`SelvaOrigin.cs:31`), and connecting then sends it to DNS and the system proxy. Lowercasing
  doesn't help, because the checksum narrows the case variants to about one. _Reproduced._ Fix:
  refuse input containing `selva_`, and hosts that are neither dotted nor loopback, in the plugin
  and in the plugin-ui field.
- **The 409 reveals hidden project names.** `create-project.ts:80` names the conflict for private
  projects the caller can't see. _Reproduced._ Fix: name it only when the caller can see that
  project.
- **Project creation has no quota.** The per-token limiter is per process (`rate-limit.ts:42`), and
  on the local provider each create rewrites the whole store. Fix: a per-owner bucket for
  project creation by API-token callers.

### Low

- **Missing capability fields count as allowed in the plugin**
  (`SelvaUploadService.cs:236`, `:271`). A new `canCreateProjects` copied from that pattern would
  offer "New project…" on servers that predate it. Fix: treat a missing field as false.

## 4. Decisions for a human

- **A new scope or a wider `upload`.** Recommend a new scope. Widening `upload` silently changes
  what existing keys and past consents mean.
- **Fix the public-visibility gate on create now**, separate from this plan. Recommend yes.
- **Project-scoped keys in the plugin.** Decide whether "Use an API key" accepts them; `/me`
  currently refuses them.

## 5. Appendix: repro

Public project on create, refused on `PATCH` (`repro.test.ts`):

```ts
await T.seedOrgMember(h, { orgId, userId: m.id, role: 'member', permissions: ['manage_projects'] });
const locals = await T.actAs(h, m.id);
const created = await T.callHandler(P.createProject, {
	locals,
	body: { name: 'Leaky', visibility: 'public', autoJoinOnUpload: true }
});
const priv = await T.callHandler(P.createProject, { locals, body: { name: 'Quiet' } });
const patched = await T.callHandler(P.updateProject, {
	locals,
	method: 'PATCH',
	params: { id: priv.json.id },
	body: { visibility: 'public' }
});
expect(created.status).toBe(201);
expect(patched.status).toBe(403);
```

Pasted key as a host (`origin-probe`, .NET):
`TryNormalize("selva_Ab3d…")` returns `ok=True, origin=https://selva_ab3d…`.
