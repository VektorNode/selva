// Run: node --test scripts/plugin/check-component-signatures.test.mjs
//
// Each test builds a scratch plugin tree, blesses it with --update, edits it,
// and runs --check against it through --root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-component-signatures.mjs');
const BOX = 'B0B0B0B0-0000-4000-8000-000000000001';
const BOX_V2 = 'B0B0B0B0-0000-4000-8000-000000000002';

function componentSource({ cls, guid, inputs }) {
	const params = inputs
		.map(
			([kind, name, access]) =>
				`        pManager.Add${kind}Parameter("${name}", "${name[0]}", "", GH_ParamAccess.${access});`
		)
		.join('\n');
	return `public class ${cls} : GH_Component
{
    public override Guid ComponentGuid => new Guid("${guid}");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
${params}
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Box", "B", "", GH_ParamAccess.item);
    }
}
`;
}

const BOX_INPUTS = [
	['Number', 'Width', 'item'],
	['Number', 'Height', 'item'],
	['Text', 'Label', 'list']
];

/** A scratch repo root holding one released component, blessed into a snapshot. */
function releasedTree() {
	const root = mkdtempSync(join(tmpdir(), 'component-signatures-'));
	write(root, 'Shapes/Components/GH_Box.cs', { cls: 'GH_Box', guid: BOX, inputs: BOX_INPUTS });
	assert.equal(run(root, '--update').status, 0);
	return root;
}

function write(root, file, component) {
	const path = join(root, 'Plugin/Selva.GH/Features', file);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, componentSource(component));
}

function move(root, from, to) {
	const features = join(root, 'Plugin/Selva.GH/Features');
	mkdirSync(dirname(join(features, to)), { recursive: true });
	renameSync(join(features, from), join(features, to));
}

function run(root, mode) {
	return spawnSync(process.execPath, [script, mode, '--root', root], { encoding: 'utf8' });
}

function assertFails(root, pattern) {
	const r = run(root, '--check');
	assert.equal(r.status, 1, `expected --check to fail\n${r.stdout}${r.stderr}`);
	assert.match(r.stderr, pattern);
}

test('an unchanged tree passes', () => {
	const r = run(releasedTree(), '--check');
	assert.equal(r.status, 0, r.stderr);
});

test('swapping two inputs of the same type is a rewire, not a rename', () => {
	const root = releasedTree();
	const [width, height, label] = BOX_INPUTS;
	write(root, 'Shapes/Components/GH_Box.cs', {
		cls: 'GH_Box',
		guid: BOX,
		inputs: [height, width, label]
	});
	assertFails(root, /Param list changed on released GUID/);
});

test('renaming an input on a released GUID is a param-list change', () => {
	const root = releasedTree();
	write(root, 'Shapes/Components/GH_Box.cs', {
		cls: 'GH_Box',
		guid: BOX,
		inputs: [['Number', 'Depth', 'item'], ...BOX_INPUTS.slice(1)]
	});
	assertFails(root, /Param list changed on released GUID/);
});

test('an added input, or a changed access, is a param-list change', () => {
	const added = releasedTree();
	write(added, 'Shapes/Components/GH_Box.cs', {
		cls: 'GH_Box',
		guid: BOX,
		inputs: [...BOX_INPUTS, ['Number', 'Depth', 'item']]
	});
	assertFails(added, /Param list changed on released GUID/);

	const access = releasedTree();
	write(access, 'Shapes/Components/GH_Box.cs', {
		cls: 'GH_Box',
		guid: BOX,
		inputs: [BOX_INPUTS[0], BOX_INPUTS[1], ['Text', 'Label', 'item']]
	});
	assertFails(access, /Param list changed on released GUID/);
});

test('a renamed class or moved file is cosmetic, and --update blesses it', () => {
	const root = releasedTree();
	move(root, 'Shapes/Components/GH_Box.cs', 'Solids/GH_Cuboid.cs');
	write(root, 'Solids/GH_Cuboid.cs', { cls: 'GH_Cuboid', guid: BOX, inputs: BOX_INPUTS });
	assertFails(root, /Cosmetic signature change/);
	assert.equal(run(root, '--update').status, 0);
	assert.equal(run(root, '--check').status, 0);
});

test('the OBSOLETE procedure passes once blessed: old GUID frozen in OBSOLETE/, new GUID live', () => {
	const root = releasedTree();
	move(root, 'Shapes/Components/GH_Box.cs', 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs');
	write(root, 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs', {
		cls: 'OBSOLETE_Box_UntilV1',
		guid: BOX,
		inputs: BOX_INPUTS
	});
	write(root, 'Shapes/Components/GH_Box.cs', {
		cls: 'GH_Box',
		guid: BOX_V2,
		inputs: [...BOX_INPUTS, ['Number', 'Depth', 'item']]
	});
	assertFails(root, /New component: GH_Box/);
	assert.equal(run(root, '--update').status, 0);
	assert.equal(run(root, '--check').status, 0);
});

test('any param change to a component in OBSOLETE/ fails', () => {
	const root = releasedTree();
	move(root, 'Shapes/Components/GH_Box.cs', 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs');
	assert.equal(run(root, '--update').status, 0);

	const [width, height, label] = BOX_INPUTS;
	write(root, 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs', {
		cls: 'GH_Box',
		guid: BOX,
		inputs: [width, height, ['Text', 'Caption', label[2]]]
	});
	assertFails(root, /OBSOLETE component changed/);
});

test('deleting a component from OBSOLETE/ fails', () => {
	const root = releasedTree();
	move(root, 'Shapes/Components/GH_Box.cs', 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs');
	assert.equal(run(root, '--update').status, 0);
	move(root, 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs', 'deleted.txt');
	assertFails(root, /OBSOLETE component removed/);
});

test('a live component reusing an OBSOLETE GUID is a duplicate', () => {
	const root = releasedTree();
	write(root, 'Shapes/OBSOLETE/OBSOLETE_Box_UntilV1.cs', {
		cls: 'OBSOLETE_Box_UntilV1',
		guid: BOX,
		inputs: BOX_INPUTS
	});
	assertFails(root, /Duplicate ComponentGuid/);
});

test('reads --root wherever it sits among the flags', () => {
	const root = releasedTree();
	const r = spawnSync(process.execPath, [script, '--root', root, '--check'], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
});

for (const argv of [[], ['--check', '--update'], ['--check', '--root'], ['--bogus'], ['check']]) {
	test(`prints usage for ${JSON.stringify(argv)}`, () => {
		const r = spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8' });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /^Usage:/);
	});
}
