import { describe, expect, it } from 'vitest';
import { supabaseUpstream } from '../upstream.js';

describe('supabaseUpstream', () => {
	it('names the service and the table or RPC a call reached', () => {
		const at = (path: string) => supabaseUpstream(new URL(`https://x.supabase.co${path}`));
		expect(at('/rest/v1/definitions?select=*')).toEqual({ key: 'db', target: 'db definitions' });
		expect(at('/rest/v1/rpc/claim_job')).toEqual({ key: 'db', target: 'db rpc/claim_job' });
		expect(at('/auth/v1/user')).toEqual({ key: 'auth', target: 'auth user' });
		expect(at('/storage/v1/object/defs/a.gh')).toEqual({
			key: 'storage',
			target: 'storage object'
		});
	});

	it('leaves any other URL to the caller', () => {
		expect(supabaseUpstream(new URL('https://compute.example/grasshopper'))).toBeUndefined();
	});
});
