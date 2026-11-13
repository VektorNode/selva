// ============================================================================
// Data format
// ============================================================================
//
// One number for everything this app persists: data files, database rows,
// at-rest envelopes. A build with format N writes data that only builds with
// format >= N can read, so the updater refuses to install a lower one.
//
// Bump it in the change that makes an older release unable to read what this
// one writes, and add a line below. `selva.dataFormat` in package.json must
// match: the updater reads the target's number from the npm registry, before
// the target's code is on the host. `pnpm check:downgrade` fails a release
// that breaks the latest stable's reads without a bump.
//
//   1  Through 4.20.0, which declares no number.
//   2  4.21.0. Boot re-seals Compute API keys as `enc:v3:`, which format 1
//      reports as plaintext and refuses to use.
//   3  4.21.0. Supabase only: sessions lose every write on `selva` tables and the
//      stores write with the service role. An older build writes as the user,
//      so on the migrated schema each of its writes is refused.

export const DATA_FORMAT = 3;

/** The format a published `package.json` declares. None means format 1. */
export function declaredDataFormat(pkg: unknown): number {
	const value = (pkg as { selva?: { dataFormat?: unknown } } | null)?.selva?.dataFormat;
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}
