// Node version-range matching, used by `selva doctor` to check an installed
// runtime and by the scaffolder to refuse a too-old shell before writing files.

/**
 * Narrow `engines.node` range check — `>=X`, `^`, `~`, `||`, and bare/x-ranges.
 * Returns null when unparseable so a misread never reports a false failure.
 *
 * Mirrors `satisfiesRange` in @selvajs/server/ops. Duplicated because the CLI is
 * dependency-free by design (it scaffolds the deployment that installs the
 * runtime, so it cannot import from it).
 */
export function satisfiesNodeRange(version, range) {
	const core = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
	if (!core) return null;
	const v = [Number(core[1]), Number(core[2]), Number(core[3])];

	let anyParsed = false;
	for (const alt of String(range).split('||')) {
		const clauses = alt.trim().split(/\s+/).filter(Boolean);
		if (!clauses.length) continue;

		let all = true;
		let parsed = true;
		for (const clause of clauses) {
			const m = /^(>=|<=|>|<|\^|~|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(clause);
			if (!m) {
				parsed = false;
				break;
			}
			const op = m[1] ?? '=';
			const num = (s) => (s == null || s === 'x' || s === '*' ? 0 : Number(s));
			const t = [Number(m[2]), num(m[3]), num(m[4])];
			let cmp = 0;
			for (let i = 0; i < 3; i++) {
				if (v[i] > t[i]) {
					cmp = 1;
					break;
				}
				if (v[i] < t[i]) {
					cmp = -1;
					break;
				}
			}
			let ok;
			if (op === '>=') ok = cmp >= 0;
			else if (op === '>') ok = cmp > 0;
			else if (op === '<=') ok = cmp <= 0;
			else if (op === '<') ok = cmp < 0;
			else if (op === '^') ok = cmp >= 0 && v[0] === t[0];
			else if (op === '~') ok = cmp >= 0 && v[0] === t[0] && v[1] === t[1];
			else
				ok =
					v[0] === t[0] &&
					(m[3] == null || m[3] === 'x' || m[3] === '*' || v[1] === t[1]) &&
					(m[4] == null || m[4] === 'x' || m[4] === '*' || v[2] === t[2]);
			if (!ok) {
				all = false;
				break;
			}
		}
		if (!parsed) continue;
		anyParsed = true;
		if (all) return true;
	}
	return anyParsed ? false : null;
}
