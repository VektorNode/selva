import { describe, it, expect } from 'vitest';
import { renderUrlFallback } from '../layout.js';

describe('renderUrlFallback', () => {
	it('takes a host label and escapes it', () => {
		const html = renderUrlFallback('https://x.test', 'Oder <kopiere> diesen Link:');
		expect(html).toContain('Oder &lt;kopiere&gt; diesen Link:');
		expect(html).not.toContain('Or paste this');
	});
});
