# Troubleshooting

Known operator-facing issues, what causes them, and how to recover. If you hit something that should live here, add an entry — the format is `Symptom → Cause → Fix`, plus prevention notes where relevant.

## At-rest decryption fails for compute server `apiKey`

### Symptom

Three places this surfaces, in escalating order of how likely an operator is to notice:

**1. `/api/health` returns 503.** This is the primary signal in production — load balancers and monitoring should catch it without a human reading logs. The response body lists which servers failed and why:

```json
{
	"status": "degraded",
	"timestamp": "...",
	"commit": "...",
	"boot": {
		"checkedAt": "...",
		"atRestSecrets": {
			"ok": false,
			"plaintextFound": false,
			"failures": [
				{
					"serverId": "...",
					"serverLabel": "rhino-compute",
					"reason": "key_mismatch",
					"cause": "Unsupported state or unable to authenticate data"
				}
			]
		}
	}
}
```

**2. Server log at boot.** A loud, identifiable line per affected server:

```
[selva][boot] compute server "rhino-compute" (<id>): key_mismatch — Unsupported state or unable to authenticate data
[selva][boot] At-rest secret verification failed. /api/health will return 503.
Recover by re-entering the affected apiKeys via /admin/compute, or by restoring
the original SELVA_AT_REST_KEY. See docs/Troubleshooting.md.
```

**3. Per-request warning.** If a route loads compute config while in this state, every call also logs a `[selva] Could not decrypt apiKey for compute server "<label>"` line. The page still renders — the affected server is returned with `apiKey: undefined` (per-row tolerance) — but any solve against it will fail.

Pre-fix, the underlying Node error bubbled up uncontextualised, causing pages like `/projects` to blank entirely:

```
Error: Unsupported state or unable to authenticate data
    at Decipheriv.final (node:internal/crypto/cipher:…)
    at decryptSecret (…/secretCrypto.ts:…)
```

### Cause

`apiKey` for compute servers is stored on disk as an AES-256-GCM envelope — `enc:v1:<base64>` — in `.selva-data/compute.config.json`. The envelope is decrypted on every read using the 32-byte key in the `SELVA_AT_REST_KEY` env var.

GCM also stores an authentication tag inside the envelope. Decryption fails (with the cryptic OpenSSL message above) when the stored ciphertext was produced under a **different** key than the one currently in env. Common ways this happens:

- `SELVA_AT_REST_KEY` was regenerated or changed in `.env`
- `.selva-data/` was restored from a backup, or copied from another machine / teammate, and was originally encrypted under a different key
- Two `.env` files in play between runs (e.g. root `.env` vs `packages/selva/.env`) resolving to different values
- The dev startup script generated a fresh key on a previous run that no longer matches the JSON

The error is **not** about wrong file format — the `enc:v1:` prefix is recognized — only about key mismatch (or, much less likely, corrupted ciphertext).

### Recovery

You have two choices. Pick whichever the situation supports.

**1. Restore the original key.** If you still have the `SELVA_AT_REST_KEY` value that was used when the apiKey was first saved, put it back in your `.env`. The existing ciphertext will decrypt and nothing else needs changing.

**2. Re-enter the apiKey.** If the original key is lost, the ciphertext is unrecoverable (this is the point of authenticated encryption). Strip the bad field and re-enter the secret:

1. Open `.selva-data/compute.config.json`.
2. Remove the `"apiKey": "enc:v1:…"` line from each affected server entry.
3. Save. The page now loads.
4. Go to `/admin/compute` and re-enter the apiKey via the UI. It will be encrypted under your current `SELVA_AT_REST_KEY` and persisted.

You do **not** need to restart the dev server — `compute.config.json` is re-read on every request.

### Prevention

- Treat `SELVA_AT_REST_KEY` like a real production secret. Back it up alongside any backup of `.selva-data/`.
- Don't ship or share `.selva-data/` between machines without also shipping the matching key — restoring data without the key bricks every encrypted field, not just compute apiKeys.
- For a fresh dev machine: generate one key once and keep it. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` produces a valid value.
- If you intentionally rotate the key, you currently have to re-enter every encrypted secret manually — there is no migration tool. Plan accordingly.

### Reference

- Envelope format and crypto primitives: [`packages/providers/local/src/data/secretCrypto.ts`](../packages/providers/local/src/data/secretCrypto.ts)
- Per-row tolerant decrypt + strict `verifySecrets()`: [`packages/providers/local/src/data/LocalComputeServerStore.ts`](../packages/providers/local/src/data/LocalComputeServerStore.ts)
- Boot-time check + health-endpoint wiring: [`packages/selva/src/lib/server/bootHealth.server.ts`](../packages/selva/src/lib/server/bootHealth.server.ts), [`packages/selva/src/routes/api/health/+server.ts`](../packages/selva/src/routes/api/health/+server.ts)
- Env var documentation: [`packages/selva/.env.example`](../packages/selva/.env.example)
