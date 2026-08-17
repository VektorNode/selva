// The Caddyfile a Selva deployment sits behind.
//
// This is the same config `infra/startup.sh.tpl` writes on the Terraform path —
// kept here as the single source so the two deployment routes can't drift.
// Anything changed in one has to be changed in the other, and a diff between
// them is a bug.
//
// Only the production (HTTPS + ACME) shape is emitted. The dev/plain-HTTP
// variant is deliberately absent: it exists in
// docs/self-hosting/deployment/Caddyfile.example for hand-editing, and a
// generator that can silently produce a no-TLS config is a footgun — Secure
// cookies are dropped over http://, so login appears to work and every
// subsequent request is anonymous.

/**
 * Render a Caddyfile for `domain`, reverse-proxying to the local app port.
 *
 * `www.<domain>` gets a permanent redirect to the apex. Skipped when the domain
 * is already a subdomain — `www.app.example.dev` is not a name anyone points at,
 * and Caddy would try to provision a certificate for it on first boot and log a
 * failure every retry.
 */
export function renderCaddyfile({ domain, acmeEmail, port = 3000 }) {
	const labels = domain.split('.').length;
	const wantsWww = labels === 2;

	const site = `${domain} {
	encode gzip

	# === HEADER AUTH SLOT ===
	# Forward-auth providers go here. See packages/providers/header-auth/README.md.

	reverse_proxy 127.0.0.1:${port}

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options    "nosniff"
		Referrer-Policy           "strict-origin-when-cross-origin"
		Permissions-Policy        "geolocation=(), microphone=(), camera=()"
		-Server
	}

	@static path /assets/*
	header @static Cache-Control "public, max-age=31536000, immutable"
	@api path /api/*
	header @api Cache-Control "no-cache, no-store, must-revalidate"

	request_body {
		max_size 100mb
	}

	log {
		output file /var/log/caddy/access.log
		format json
	}
}`;

	const www = wantsWww
		? `

www.${domain} {
	redir https://${domain}{uri} permanent
}`
		: '';

	return `{
	email ${acmeEmail}
}

${site}${www}
`;
}

/** A hostname Caddy can request a certificate for. */
export function isServableDomain(value) {
	if (typeof value !== 'string') return false;
	const domain = value.trim();
	if (domain === '' || domain.length > 253) return false;
	// Rejects bare hostnames, IPs, and anything with a scheme, port, or path —
	// ACME issues against a resolvable FQDN and nothing else.
	return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
		domain
	);
}

/** The origin a given domain implies, for cross-checking `.env`. */
export function originFor(domain) {
	return `https://${domain}`;
}
