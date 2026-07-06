# Migrating off Azure AD Application Proxy (solve-performance fix)

**Status:** proposal — technical runbook
**Date of measurements:** 2026-07-06, `selva.herding.de`
**Audience:** whoever operates the Selva deployment. A plain-language companion for the
IT department is in [app-proxy-migration-IT-summary.md](./app-proxy-migration-IT-summary.md).

---

## 1. The problem, with numbers

The deployment is published through **Microsoft Entra Application Proxy**
(`selva.herding.de` → CNAME → `*.msappproxy.net` → connector → Caddy → Selva).
App Proxy relays every byte through Microsoft's cloud edge (observed:
`proxy-appproxy-WEUR-AMS02P`, confirmed by `x-ms-proxy-*` response headers on
`/api/compute` responses).

Measured effect (browser `[Compute/browser]` instrumentation, 2026-07-06):

| Metric                                                  | Measured                      | Notes                                                                            |
| ------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Per-stream throughput through App Proxy                 | **~0.7–0.9 MB/s (~6 Mbit/s)** | flat across 0.28 / 2.25 / 17–21 MB payloads → per-stream ceiling, not congestion |
| Round-trip latency through App Proxy                    | 192–602 ms                    | variable                                                                         |
| 21.5 MB solve result, uncompressed                      | ~25–29 s download             | before gzip                                                                      |
| 17.4 MB solve result, gzipped to 9.1 MB (1.9×)          | ~11 s download                | after gzip (shipped)                                                             |
| 1.58 MB solve _request_ (uplink)                        | 0–3 s, spikes to ~9.6 s       | same ceiling in the upload direction; surfaced as the `body` prep mark           |
| Selva server work per solve (`load`+`tree`+`serialize`) | **~0.3 s**                    | the app itself is not the bottleneck                                             |
| Rhino solve                                             | 6–8 s                         | independent issue (definition/compute-server)                                    |

Conclusion: the transport ceiling is App Proxy's per-stream relay, in **both
directions**. Compression (already shipped) halves the pain; it cannot remove it.
The only structural fix is to take the traffic out of the App Proxy path.

Why App Proxy behaves like this: it is designed for intranet web _pages_
(tens–hundreds of KB), not multi-MB geometry payloads. Each HTTP response is a
single flow-controlled stream through the relay; aggregate throughput scales with
_concurrent users_, not per-transfer. Microsoft's own guidance emphasizes topology
and latency limits ([network topology considerations](https://learn.microsoft.com/en-us/entra/identity/app-proxy/application-proxy-network-topology)).
There is no throughput SLA.

## 2. Target architecture

Replace App Proxy's two roles (public entry point + Entra pre-authentication)
with pieces we run ourselves. Users keep the exact same "sign in with Microsoft"
experience.

```
                       ┌────────────────────────────┐
                       │  Microsoft Entra ID (OIDC) │
                       └─────────────┬──────────────┘
                                     │ app registration
                                     │ (client id + secret)
   user ──HTTPS 443──►  Caddy on the server
                          │  1. strips inbound SELVA-* headers
                          │  2. forward_auth → oauth2-proxy (Entra OIDC session)
                          │  3. copies trusted SELVA-* identity headers
                          ▼
                        Selva (adapter-node, bound to 127.0.0.1:3000)
                          └─ @selvajs/header-auth-provider reads SELVA-* headers
```

- **TLS:** Caddy, automatic Let's Encrypt (already configured in
  [Caddyfile.example](./Caddyfile.example)).
- **Auth:** [`@selvajs/header-auth-provider`](../../packages/providers/header-auth/README.md)
  — purpose-built for this pattern. Read its README **in full**; the security
  model is "the deployment is the boundary".
- **OIDC helper:** [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
  (single binary/container) does the Entra login dance and answers Caddy's
  `forward_auth` checks.

No Selva source-code changes are required — only `selva.config.ts` + env vars.

## 3. Prerequisites (blockers — resolve first)

1. **Inbound TCP 443** must be allowed to the server from wherever users are
   (internet or corporate WAN). This is the gating IT decision.
2. **DNS control** over `selva.herding.de` (currently CNAME to `*.msappproxy.net`).
3. **An Entra app registration** for oauth2-proxy (same class of object as the
   existing App Proxy app; whoever created that can create this).
4. **Current-auth inventory.** If users already own projects/definitions under a
   _different_ Selva auth provider, switching providers changes identity keys and
   can orphan content. Confirm what `selva.config.ts` uses today and how many
   real users own data before cutover. (If App Proxy was the only login and the
   app behind it is effectively open, this is a non-issue.)

## 4. Runbook

### 4.1 Entra app registration (Azure portal / IT)

- New app registration, e.g. `selva-oidc`.
- Redirect URI: `https://selva.herding.de/oauth2/callback`
- Note tenant ID, client ID; create a client secret.
- Optional claims: `upn`, `email`, `name` in the ID token (oauth2-proxy maps these).
- Restrict assignment to the same user group that the App Proxy app uses today.

### 4.2 oauth2-proxy on the server

Run as a service on loopback (`127.0.0.1:9091`). Reference config:

```ini
# /etc/oauth2-proxy/oauth2-proxy.cfg
provider          = "entra-id"            # (formerly "azure" / "oidc")
oidc_issuer_url   = "https://login.microsoftonline.com/<TENANT_ID>/v2.0"
client_id         = "<CLIENT_ID>"
client_secret     = "<CLIENT_SECRET>"
redirect_url      = "https://selva.herding.de/oauth2/callback"

http_address      = "127.0.0.1:9091"
reverse_proxy     = true
cookie_secret     = "<openssl rand -base64 32 | head -c 32>"
cookie_secure     = true
email_domains     = ["herding.de"]        # tighten as appropriate

# Emit identity headers for Caddy to copy (names must match Selva's env)
set_xauthrequest  = true
```

oauth2-proxy exposes the verified identity on its auth-response headers
(`X-Auth-Request-Preferred-Username`, `X-Auth-Request-Email`, …). Map them to the
`SELVA-*` names in the Caddy block below, or set
`HEADER_AUTH_UPN_HEADER=X-Auth-Request-Preferred-Username` etc. on the Selva side —
either works; pick one and keep it consistent.

### 4.3 Caddyfile

Follow [Caddyfile.example](./Caddyfile.example) and fill the
`=== HEADER AUTH SLOT ===` with (adjust header names to your 4.2 choice):

```caddyfile
selva.herding.de {
	encode gzip

	# Strip spoofable inbound copies BEFORE auth runs (see provider README).
	request_header -SELVA-UserPrincipalName
	request_header -SELVA-Email
	request_header -SELVA-DisplayName

	# oauth2-proxy endpoints (login/callback) must bypass forward_auth.
	handle /oauth2/* {
		reverse_proxy 127.0.0.1:9091
	}

	forward_auth 127.0.0.1:9091 {
		uri /oauth2/auth
		copy_headers X-Auth-Request-Preferred-Username>SELVA-UserPrincipalName X-Auth-Request-Email>SELVA-Email

		# On 401, send the browser to the login flow.
		@bad status 401
		handle_response @bad {
			redir * /oauth2/start?rd={scheme}://{host}{uri}
		}
	}

	reverse_proxy 127.0.0.1:3000
	# …keep the hardening headers / static cache blocks from Caddyfile.example
}
```

### 4.4 Selva configuration (no code changes)

`selva.config.ts`:

```ts
import { defineConfig } from '@selvajs/platform';
import * as local from '@selvajs/local-provider';
import { HeaderAuthProvider } from '@selvajs/header-auth-provider';

export default defineConfig((env) => ({
	tenancy: 'single' as const,
	auth: HeaderAuthProvider.fromEnv(env),
	// keep whatever data/storage providers are in use today
	data: local.LocalDataProvider.fromEnv(env),
	storage: local.LocalStorageProvider.fromEnv(env)
}));
```

Env (see [.env.example](../../packages/selva/.env.example) and the
[provider README](../../packages/providers/header-auth/README.md) for the full list):

```bash
HOST=127.0.0.1                 # loopback only — THE security boundary
PORT=3000
HEADER_AUTH_DATA_DIR=/var/lib/selva      # or reuse DATA_PATH
BOOTSTRAP_INSTANCE_ADMIN_EMAIL=you@herding.de
```

### 4.5 Cutover

1. Deploy 4.2–4.4 with a temporary test hostname (or hosts-file entry) while
   `selva.herding.de` still points at App Proxy.
2. Run the verification suite (4.6) against the test hostname.
3. Switch DNS: `selva.herding.de` A/AAAA → server IP (drop the msappproxy CNAME).
   Low TTL beforehand makes rollback near-instant.
4. Leave the App Proxy app in place but unassigned for a week (rollback = revert DNS).
5. Then retire the App Proxy app + connector.

### 4.6 Verification (mandatory — from the provider README)

```bash
# 1. Network isolation: MUST fail from any machine that isn't the server.
curl -m 5 http://<server-public-ip>:3000/ && echo "FAIL: app is directly reachable"

# 2. Spoof attempt: MUST NOT authenticate as the spoofed user.
curl -H "SELVA-UserPrincipalName: admin@herding.de" https://selva.herding.de/api/me

# 3. Unauthenticated request: MUST redirect to Microsoft login.
curl -sD - -o /dev/null https://selva.herding.de/ | grep -i location

# 4. Real login in a browser → confirm bootstrap admin, then solve a definition.
```

Success criteria for the original problem: the `[Compute/browser]` log line on a
large solve shows `download` at the server's real line speed (expect **≥ 10×**
improvement over the ~0.8 MB/s baseline) and `network≈` drops to direct-path RTT.

### 4.7 Rollback

Revert the DNS record to the msappproxy CNAME. Nothing else needs undoing;
App Proxy config is untouched until step 4.5's retirement.

## 5. Complementary optimizations (independent of the migration)

Already shipped:

- **gzip on `/api/compute` responses** (~1.9× on measured payloads).
- Full per-phase timing: browser log + `Server-Timing` header (`prep`, cache
  verdicts, rhino split, wire cross-check) — no server log access needed.

Worth doing regardless of transport:

- **Slim the solve request** (measured 1.58 MB uplink per solve). The `req=` /
  `values` figures in the browser log identify whether a geometry/file input in
  `values` or the echoed schema `inputs` dominates. If it's `inputs`: the server
  already stores the schema per version and could derive it server-side instead
  of trusting the client copy.
- **Reduce result size at the source**: coarser GH meshing, drop outputs the UI
  never reads. Helps the compute↔server leg too, which stays internal either way.
- **Rhino solve time (6–8 s)** is unrelated to transport — pursue via definition
  profiling and compute-server warmth/queue tuning.

## 6. Open questions

- [ ] Which auth provider does production `selva.config.ts` use today? Any real
      users owning content (→ identity-migration plan needed)?
- [ ] Can inbound 443 be opened (IT)? If **no**, this migration is dead and the
      fallback is payload reduction only — set expectations accordingly.
- [ ] Who owns DNS for `herding.de` and the Entra tenant for app registrations?
- [ ] Recurrent `503` on draft-channel solves observed 2026-07-06 — track down
      separately (compute server resolve/availability, not transport).
