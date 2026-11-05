import { afterEach, describe, expect, it, vi } from 'vitest';

type FakeElement = {
	type?: string;
	accept?: string;
	href?: string;
	download?: string;
	files?: File[];
	style: Record<string, string>;
	listeners: Record<string, () => void>;
	addEventListener: (event: string, listener: () => void) => void;
	click: () => void;
	remove: () => void;
};

/** A document just big enough for the anchor and the hidden input, without a DOM. */
function stubDocument(onClick: (el: FakeElement) => void) {
	const created: FakeElement[] = [];
	vi.stubGlobal('document', {
		createElement: () => {
			const el: FakeElement = {
				style: {},
				listeners: {},
				addEventListener(event, listener) {
					el.listeners[event] = listener;
				},
				click: () => onClick(el),
				remove: () => {}
			};
			created.push(el);
			return el;
		},
		body: { appendChild: () => {} }
	});
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	return created;
}

// Fresh module per test: the installed saver and picker are module state.
async function load() {
	vi.resetModules();
	return import('../host-files');
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('host files', () => {
	it('saves through an anchor download by default', async () => {
		const clicked: FakeElement[] = [];
		stubDocument((el) => clicked.push(el));
		const { saveBlob } = await load();

		expect(await saveBlob(new Blob(['x']), 'facade.zip')).toBe(true);

		expect(clicked).toHaveLength(1);
		expect(clicked[0].download).toBe('facade.zip');
	});

	it('picks through a hidden file input by default', async () => {
		const file = new File(['x'], 'preset.slvp');
		const created = stubDocument((el) => {
			el.files = [file];
			el.listeners.change();
		});
		const { pickFile } = await load();

		expect(await pickFile({ accept: '.slvp,.sps' })).toBe(file);
		expect(created[0].type).toBe('file');
		expect(created[0].accept).toBe('.slvp,.sps');
	});

	it('resolves null when the user cancels the input', async () => {
		stubDocument((el) => el.listeners.cancel());
		const { pickFile } = await load();

		expect(await pickFile({ accept: '*' })).toBeNull();
	});

	it('routes every save and pick through an installed host instead', async () => {
		const clicked: FakeElement[] = [];
		stubDocument((el) => clicked.push(el));
		const { saveBlob, pickFile, setBlobSaver, setFilePicker } = await load();
		const saved: string[] = [];
		const picked = new File(['y'], 'model.3dm');

		setBlobSaver(async (_blob, fileName) => {
			saved.push(fileName);
			return false;
		});
		setFilePicker(async () => picked);

		expect(await saveBlob(new Blob(['x']), 'facade.zip')).toBe(false);
		expect(saved).toEqual(['facade.zip']);
		expect(await pickFile({ accept: '.3dm' })).toBe(picked);
		expect(clicked).toEqual([]);
	});
});
