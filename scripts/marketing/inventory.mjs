#!/usr/bin/env node

// Lists what the live session's form offers, tab by tab: the names a storyboard in
// storyboards.mjs can pick, slide or switch.
//
//   node scripts/marketing/inventory.mjs [--url '<UI Bridge URL>']

import { sessionUrlOr } from '../plugin/dev-session.mjs';
import { flag, launch, openPage } from './lib.mjs';

const session = new URL(sessionUrlOr(flag('url')));
const browser = await launch();
const page = await openPage(browser, { scale: 1 });
await page.goto(Object.assign(new URL(session), { pathname: '/preview' }).toString(), {
	waitUntil: 'domcontentloaded'
});
await page.getByText('Loading preview...').waitFor({ state: 'hidden' });
await page.getByTestId('viewer-canvas').waitFor();
await page.waitForTimeout(2500);

const tabs = page.getByRole('tablist').first().getByRole('tab');
const count = await tabs.count();
for (let i = 0; i < Math.max(1, count); i++) {
	if (count) {
		await tabs.nth(i).click();
		await page.waitForTimeout(500);
		console.info(`\n# ${await tabs.nth(i).innerText()}`);
	}
	const lines = await page.evaluate(() => {
		// Every tab's panel stays in the document; only the open one is laid out.
		const panel =
			[...document.querySelectorAll('[role="tabpanel"]')].find((p) => p.offsetParent) ??
			document.body;
		const label = (el) => {
			const group =
				el.closest('[role="group"]')?.parentElement?.closest('[role="group"]') ??
				el.closest('[role="group"]');
			return (group?.innerText ?? '').split('\n')[0].trim();
		};
		const out = [];
		for (const group of panel.querySelectorAll('[role="radiogroup"]')) {
			const options = [...group.querySelectorAll('[role="radio"]')].map(
				(o) =>
					`${o.getAttribute('aria-checked') === 'true' ? '*' : ''}${o.innerText.trim() || o.title}`
			);
			out.push(`pick   ${label(group)}: ${options.join(' | ')}`);
		}
		for (const slider of panel.querySelectorAll('[role="slider"]')) {
			out.push(
				`slide  ${label(slider)}: ${slider.getAttribute('aria-valuemin')}..${slider.getAttribute('aria-valuemax')} now ${slider.getAttribute('aria-valuenow')}`
			);
		}
		for (const box of panel.querySelectorAll('[role="checkbox"], [role="switch"]')) {
			out.push(
				`switch ${(box.closest('label, div')?.innerText ?? '').trim().split('\n')[0]}: ${box.getAttribute('aria-checked')}`
			);
		}
		for (const el of panel.querySelectorAll(
			'button:not([role]), select, [role="combobox"], input[type="text"]'
		)) {
			const text = (el.innerText || el.getAttribute('aria-label') || el.value || '')
				.trim()
				.split('\n')[0];
			if (text && !/^Help for/.test(text)) out.push(`other  ${el.tagName.toLowerCase()} ${text}`);
		}
		return out;
	});
	console.info(lines.join('\n'));
}
await browser.close();
