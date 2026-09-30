import { describe, it, expect } from 'vitest';
import { parseComputeMessage, parseComputeDiagnostics } from '../compute-diagnostics.js';

describe('parseComputeMessage', () => {
	it('strips the attribution suffix Compute appends to every message', () => {
		const out = parseComputeMessage(
			'Radius scale above 2 makes the spheres overlap heavily: component "Message" (2ae32b34-fd18-4d18-94b4-124ce2e6dec6)'
		);
		expect(out.message).toBe('Radius scale above 2 makes the spheres overlap heavily');
		expect(out.source).toBe('Message');
	});

	it('keeps text that merely mentions a component, with no guid to anchor on', () => {
		const out = parseComputeMessage('check the component "Foo" before solving');
		expect(out.message).toBe('check the component "Foo" before solving');
		expect(out.source).toBeUndefined();
	});

	it('strips the block marker and the numbered exception wrapper', () => {
		const out = parseComputeMessage(
			'1. Solution exception:[Selva:blocked] More than 200 spheres: component "Message" (380977dd-7cb3-49c0-af7a-d808e4f93a59)'
		);
		expect(out.message).toBe('More than 200 spheres');
		expect(out.blocked).toBe(true);
		expect(out.authored).toBe(true);
	});

	it('strips the authored marker from a non-blocking message', () => {
		const out = parseComputeMessage('[Selva:msg] Only a few spheres');
		expect(out.message).toBe('Only a few spheres');
		expect(out.blocked).toBe(false);
		expect(out.authored).toBe(true);
	});

	it('leaves an unattributed script exception intact', () => {
		const out = parseComputeMessage('1. Solution exception:index out of range');
		expect(out.message).toBe('1. Solution exception:index out of range');
		expect(out.authored).toBe(false);
	});
});

describe('parseComputeDiagnostics', () => {
	it('marks only authored messages as gates', () => {
		const out = parseComputeDiagnostics(
			['[Selva:blocked] refused: component "Message" (380977dd-7cb3-49c0-af7a-d808e4f93a59)'],
			[
				'Parameter failed to collect data: component "Voronoi" (2ae32b34-fd18-4d18-94b4-124ce2e6dec6)'
			]
		);
		expect(out).toEqual([
			{ level: 'error', message: 'refused', source: 'Message', isGate: true },
			{
				level: 'warning',
				message: 'Parameter failed to collect data',
				source: 'Voronoi'
			}
		]);
	});

	it('treats an unmarked message from a Message component as a gate (pre-marker definitions)', () => {
		const [d] = parseComputeDiagnostics(
			[],
			['Only a few spheres: component "Message" (3ae9988e-6572-4042-8422-0481be7b7cd2)']
		);
		expect(d.isGate).toBe(true);
	});
});

describe('the real strings from a Compute solve of live_solve_showcase', () => {
	it("separates the author's two messages from Grasshopper's own warning", () => {
		const out = parseComputeDiagnostics(
			[
				'1. Solution exception:[Selva:blocked] More than 200 spheres is too heavy for the web viewer: refused: component "Message" (380977dd-7cb3-49c0-af7a-d808e4f93a59)'
			],
			[
				'Radius scale above 2 makes the spheres overlap heavily: component "Message" (2ae32b34-fd18-4d18-94b4-124ce2e6dec6)',
				'Parameter failed to collect data: component "Voronoi" (0f44f938-67c3-41e1-a480-106a027226e8)'
			]
		);

		expect(out).toEqual([
			{
				level: 'error',
				message: 'More than 200 spheres is too heavy for the web viewer: refused',
				source: 'Message',
				isGate: true
			},
			{
				level: 'warning',
				message: 'Radius scale above 2 makes the spheres overlap heavily',
				source: 'Message',
				isGate: true
			},
			{ level: 'warning', message: 'Parameter failed to collect data', source: 'Voronoi' }
		]);
	});
});

describe('Notify = Log', () => {
	it('keeps the message and its source, but does not gate', () => {
		const [d] = parseComputeDiagnostics(
			[],
			['[Selva:log] Radius is unusual: component "Message" (2ae32b34-fd18-4d18-94b4-124ce2e6dec6)']
		);
		expect(d).toEqual({
			level: 'warning',
			message: 'Radius is unusual',
			source: 'Message'
		});
		expect(d.isGate).toBeUndefined();
	});

	it('never silences an error: a withheld result must be explained', () => {
		// The component refuses to write the log marker on an error, but a hand-edited or
		// future payload must not be able to hide one either.
		const [d] = parseComputeDiagnostics(
			['[Selva:blocked] Wall too thin: component "Message" (380977dd-7cb3-49c0-af7a-d808e4f93a59)'],
			[]
		);
		expect(d.isGate).toBe(true);
	});
});
