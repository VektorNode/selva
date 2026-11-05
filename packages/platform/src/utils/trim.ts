// Not `s.replace(/x+$/, '')`: that regex backtracks quadratically on a long
// run of `x` that isn't at the end, and these strings come from config.
export function trimTrailing(s: string, ch: string): string {
	let end = s.length;
	while (end > 0 && s[end - 1] === ch) end--;
	return s.slice(0, end);
}
