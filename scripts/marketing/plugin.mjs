#!/usr/bin/env node

/**
 * Stills and videos of the plugin UI for the definition open in Rhino, from its live UI Bridge.
 *
 *   node scripts/marketing/plugin.mjs --name kitchen-run [--url '<UI Bridge URL>'] [--only stills|videos]
 *        [--take preview|builder] [--zoom 3]
 *
 * --zoom scrolls the wheel that many steps into the 3D view, for a model framed inside a large
 * context.
 *
 * Without --url it takes the newest session of a dev install (`pnpm plugin:session`). Writes to
 * marketing/plugin/<name>/. Form edits reach Grasshopper like a user's; nothing is saved.
 */

import { sessionUrlOr } from '../plugin/dev-session.mjs';
import {
	PHONE,
	VIDEO,
	click,
	dragTo,
	flag,
	glide,
	glideTo,
	launch,
	openPage,
	pause,
	record,
	still
} from './lib.mjs';
import { storyboards } from './storyboards.mjs';

const name = flag('name');
if (!name) {
	console.error(
		"Usage: node scripts/marketing/plugin.mjs --name <example> [--url '<UI Bridge URL>']"
	);
	process.exit(2);
}
const only = flag('only');
const take = flag('take');
const board = storyboards[name];
const zoom = Number(flag('zoom', board?.zoom ?? 0));
const session = new URL(sessionUrlOr(flag('url')));
const at = (pathname) => Object.assign(new URL(session), { pathname }).toString();
const out = (file) => `plugin/${name}/${file}`;
const slug = (text) => text.trim().replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const LOOKS = ['Showcase', 'Studio', 'Arctic', 'Line Art'];

// ============================================================================
// Page helpers
// ============================================================================

async function openBuilder(page) {
	await page.goto(at('/builder'), { waitUntil: 'domcontentloaded' });
	await page.getByText('Loading schema...').waitFor({ state: 'hidden' });
	await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
	await page.waitForTimeout(1500);
}

async function settle(page, rest = 1200) {
	// A fast solve may never leave "Up to date"; give a slow one time to start first.
	await page.waitForTimeout(400);
	await page
		.getByTestId('solve-status')
		.filter({ hasText: /Up to date/ })
		.waitFor({ timeout: 180_000 });
	await page.waitForTimeout(rest);
}

async function openPreview(page) {
	await page.goto(at('/preview'), { waitUntil: 'domcontentloaded' });
	await page.getByText('Loading preview...').waitFor({ state: 'hidden' });
	await page.getByTestId('viewer-canvas').waitFor();
	await settle(page, 3000);
	if (zoom) {
		const box = await canvasBox(page);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		for (let i = 0; i < zoom; i++) {
			await page.mouse.wheel(0, -240);
			await page.waitForTimeout(150);
		}
		await page.waitForTimeout(800);
	}
}

const canvasBox = (page) => page.getByTestId('viewer-canvas').boundingBox();

/** The viewer's toolbar stays tucked under its bottom edge until the pointer comes near. */
async function revealToolbar(page) {
	const box = await canvasBox(page);
	await glide(page, box.x + box.width * 0.52, box.y + box.height - 24);
	await page.waitForTimeout(500);
}

async function restPointer(page) {
	const box = await canvasBox(page);
	await glide(page, box.x + box.width * 0.55, box.y + box.height * 0.4);
	await page.waitForTimeout(900);
}

async function setLook(page, look) {
	await revealToolbar(page);
	await click(page, page.getByRole('button', { name: 'Display' }));
	await click(page, page.getByRole('menuitemradio', { name: look, exact: true }));
	await page.keyboard.press('Escape');
	await restPointer(page);
}

/** Night is a switch on top of the day look, not one of the looks. */
async function toggleNight(page) {
	await page.getByTestId('viewer-canvas').focus();
	await page.keyboard.press('n');
	await page.waitForTimeout(1800);
}

async function orbit(page, dx, dy = 0) {
	const box = await canvasBox(page);
	const x = box.x + box.width * 0.5;
	const y = box.y + box.height * 0.55;
	await glide(page, x - dx / 2, y - dy / 2);
	await dragTo(page, x + dx / 2, y + dy / 2, { duration: 2000, arc: 1.4 });
}

async function dragSlider(page, thumb) {
	const box = await thumb.boundingBox();
	const row = await thumb.locator('xpath=ancestor::*[@role="group"][1]').boundingBox();
	if (!box || !row) return;
	// Toward the roomier side of the track, so the drag never pins at an end.
	const dx = box.x < row.x + row.width * 0.6 ? 96 : -96;
	await glideTo(page, thumb);
	await dragTo(page, box.x + box.width / 2 + dx, box.y + box.height / 2 + 2, { duration: 950 });
}

const formTabs = (page) => page.getByRole('tablist').first().getByRole('tab');
// By their drag handle: the sidebar's unplaced parameters and each group's rows are list items too.
const builderTabs = (page) =>
	page
		.getByRole('listitem')
		.filter({ has: page.getByRole('button', { name: 'Drag to reorder tab', exact: true }) });

// ============================================================================
// Stills
// ============================================================================

async function builderStills(browser) {
	const page = await openPage(browser);
	await openBuilder(page);

	const tabs = builderTabs(page);
	// Counted every round: the strip holds one more item while the page settles.
	for (let i = 0; i < (await tabs.count()); i++) {
		const label = await tabs.nth(i).innerText();
		await tabs.nth(i).getByRole('button').last().click();
		await page.waitForTimeout(500);
		await still(page, out(`builder-tab-${i + 1}-${slug(label)}`), { fullPage: true });
	}
	if (await tabs.count()) await tabs.first().getByRole('button').last().click();

	const expand = page.getByRole('button', { name: 'Expand details' });
	for (let i = 0; i < Math.min(3, await expand.count()); i++) {
		await expand.nth(i).click();
		await page.waitForTimeout(400);
	}
	await still(page, out('builder-parameter-settings'), { fullPage: true });

	for (const panel of ['App', 'Viewer', 'Local', 'Compute', 'Parameters']) {
		const tab = page.getByRole('tab', { name: panel, exact: true });
		if (!(await tab.count())) continue;
		await tab.click();
		await page.waitForTimeout(600);
		await still(page, out(`builder-panel-${slug(panel)}`));
	}
	await page.context().close();

	const dark = await openPage(browser, { dark: true });
	await openBuilder(dark);
	await still(dark, out('builder-dark'));
	await dark.context().close();
}

async function previewStills(browser) {
	const page = await openPage(browser);
	await openPreview(page);

	const tabs = formTabs(page);
	const count = await tabs.count();
	for (let i = 0; i < Math.max(1, count); i++) {
		const label = count ? await tabs.nth(i).innerText() : 'form';
		if (count) await tabs.nth(i).click();
		await page.waitForTimeout(700);
		await still(page, out(`preview-tab-${i + 1}-${slug(label)}`));
	}
	if (count) await tabs.first().click();

	for (const look of LOOKS) {
		await setLook(page, look);
		await still(page, out(`preview-${slug(look)}`));
		await still(page, out(`view-${slug(look)}`), { clip: await canvasBox(page) });
	}
	await setLook(page, 'Showcase');
	await toggleNight(page);
	await still(page, out('preview-night'));
	await still(page, out('view-night'), { clip: await canvasBox(page) });
	await page.context().close();

	const dark = await openPage(browser, { dark: true });
	await openPreview(dark);
	await setLook(dark, 'Showcase');
	await still(dark, out('preview-dark'));
	await toggleNight(dark);
	await still(dark, out('preview-dark-night'));
	await dark.context().close();

	const phone = await openPage(browser, { viewport: PHONE, scale: 3 });
	await openPreview(phone);
	await still(phone, out('preview-phone'));
	await phone.context().close();
}

// ============================================================================
// Videos
// ============================================================================

const visible = (locator) => locator.filter({ visible: true }).first();

/** One storyboard step; see storyboards.mjs for the vocabulary. */
async function act(page, step) {
	const [verb, a, b, c] = step;
	switch (verb) {
		case 'wait':
			return pause(page, a);
		case 'tab':
			await click(page, formTabs(page).filter({ hasText: a }).first());
			return pause(page, 600, 900);
		case 'pick':
			await click(page, visible(page.getByRole('radio', { name: a, exact: true })));
			return settle(page);
		case 'switch':
			await click(
				page,
				visible(page.getByRole('switch', { name: a }))
					.or(visible(page.getByRole('checkbox', { name: a })))
					.first()
			);
			return settle(page);
		case 'slide': {
			const row = visible(page.getByRole('group').filter({ hasText: a }));
			const thumb = row.getByRole('slider').first();
			const track = await thumb.locator('xpath=..').boundingBox();
			const box = await thumb.boundingBox();
			await glideTo(page, thumb);
			await dragTo(page, track.x + track.width * b, box.y + box.height / 2 + 2, {
				duration: c ?? 1000
			});
			return settle(page);
		}
		case 'choose': {
			const row = visible(page.getByRole('group').filter({ hasText: a }));
			// The row's first button may be its help mark; the dropdown is the last.
			await click(page, row.getByRole('button').or(row.getByRole('combobox')).last());
			await pause(page, 350, 500);
			const options = page.getByRole('option');
			await click(
				page,
				typeof b === 'number' ? options.nth(b) : options.filter({ hasText: b }).first()
			);
			return settle(page);
		}
		case 'dropdown': {
			const panel = visible(page.getByRole('tabpanel'));
			await click(page, panel.locator('[role="combobox"], button[aria-haspopup]').nth(a));
			await pause(page, 350, 500);
			const options = page.getByRole('option');
			await click(
				page,
				typeof b === 'number' ? options.nth(b) : options.filter({ hasText: b }).first()
			);
			return settle(page);
		}
		case 'orbit':
			await orbit(page, a, b ?? 0);
			return pause(page, 300, 600);
		case 'night':
			return toggleNight(page);
		case 'look':
			return setLook(page, a);
		case 'scroll': {
			const panel = await visible(page.getByRole('tabpanel')).boundingBox();
			await glide(page, panel.x + panel.width * 0.5, panel.y + panel.height * 0.5);
			for (let i = 0; i < 6; i++) {
				await page.mouse.wheel(0, a / 6);
				await page.waitForTimeout(45);
			}
			return pause(page, 500, 800);
		}
		default:
			throw new Error(`Unknown storyboard step "${verb}"`);
	}
}

async function storyboardTour(browser) {
	const page = await openPage(browser, { viewport: VIDEO, scale: 1, cursor: true });
	await openPreview(page);
	await setLook(page, board.look ?? 'Showcase');
	// Off camera: the state the take starts from.
	for (const step of board.reset ?? []) await act(page, step);
	if (board.reset?.length) await restPointer(page);

	await record(page, out('preview-tour'), async () => {
		await pause(page, 900);
		for (const step of board.preview) await act(page, step);
		await pause(page, 900);
	});
	await page.context().close();
}

/** Works on any definition: look around, change an option and a slider per tab, then night. */
async function previewTour(browser) {
	if (board?.preview) return storyboardTour(browser);
	const page = await openPage(browser, { viewport: VIDEO, scale: 1, cursor: true });
	await openPreview(page);
	await setLook(page, 'Showcase');

	await record(page, out('preview-tour'), async () => {
		await pause(page, 900);
		await orbit(page, 170, -12);
		await pause(page, 500, 900);

		const tabs = formTabs(page);
		const count = await tabs.count();
		for (let i = 0; i < Math.max(1, Math.min(3, count)); i++) {
			if (count && i > 0) {
				await click(page, tabs.nth(i));
				await pause(page, 600, 900);
			}
			const panel = page.getByRole('tabpanel').first();
			const scope = (await panel.count()) ? panel : page;

			const radios = scope.getByRole('radiogroup').first().getByRole('radio');
			const pick = Math.min(2, (await radios.count()) - 1);
			if (pick > 0 && (await radios.nth(pick).isVisible())) {
				await click(page, radios.nth(pick));
				await settle(page);
			}

			const sliders = scope.getByRole('slider');
			for (let s = 0; s < Math.min(i === 0 ? 2 : 1, await sliders.count()); s++) {
				if (!(await sliders.nth(s).isVisible())) continue;
				await dragSlider(page, sliders.nth(s));
				await settle(page);
			}
		}

		await orbit(page, -240, 16);
		await pause(page, 400, 700);
		await toggleNight(page);
		await orbit(page, 150, -8);
		await pause(page, 900);
	});
	await page.context().close();
}

async function builderTour(browser) {
	const page = await openPage(browser, { viewport: VIDEO, scale: 1, cursor: true });
	await openBuilder(page);

	await record(page, out('builder-tour'), async () => {
		await pause(page, 900);
		const tabs = builderTabs(page);
		for (let i = 1; i < Math.min(3, await tabs.count()); i++) {
			await click(page, tabs.nth(i).getByRole('button').last());
			await pause(page, 900, 1300);
		}
		await click(page, tabs.first().getByRole('button').last());
		await pause(page, 500, 800);

		const expand = page.getByRole('button', { name: 'Expand details' }).first();
		if (await expand.count()) {
			await click(page, expand);
			await pause(page, 1500, 1900);
			await click(
				page,
				page.getByRole('button', { name: /Collapse details|Expand details/ }).first()
			);
			await pause(page, 400, 600);
		}

		// Reorder two parameters, then take it back, so the save below writes the schema it read.
		const handles = page.getByRole('button', { name: 'Drag to reorder', exact: true });
		if ((await handles.count()) > 3) {
			const to = await handles.nth(3).boundingBox();
			await glideTo(page, handles.nth(1));
			await dragTo(page, to.x + to.width / 2, to.y + to.height / 2 + 14, { duration: 1100 });
			await pause(page, 800, 1100);
			await page.keyboard.press('Control+z');
			await pause(page, 700, 900);
		}

		for (const panel of ['App', 'Viewer']) {
			const tab = page.getByRole('tab', { name: panel, exact: true });
			if (!(await tab.count())) continue;
			await click(page, tab);
			await pause(page, 1200, 1500);
		}

		// The builder asks about unsaved edits before it leaves, and opening a panel counts as one.
		await click(page, page.getByRole('button', { name: 'Save', exact: true }));
		await pause(page, 900, 1200);
		await click(page, page.getByRole('button', { name: 'Interactive Preview' }));
		await page.getByTestId('viewer-canvas').waitFor();
		await settle(page, 1500);
		await orbit(page, 170, -10);
	});
	await page.context().close();
}

// ============================================================================
// Go
// ============================================================================

const browser = await launch();
try {
	if (only !== 'videos') {
		await builderStills(browser);
		await previewStills(browser);
	}
	if (only !== 'stills') {
		if (take !== 'builder') await previewTour(browser);
		if (take !== 'preview') await builderTour(browser);
	}
} finally {
	await browser.close();
}
