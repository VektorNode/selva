import { expect, test } from '@playwright/test';

// Smoke flows over the public, dependency-free surface. With the local provider
// on a fresh DATA_PATH there is no admin yet, so the deepest we can go without
// seeding is the unauthenticated landing + login pages. Compute / admin flows
// belong in their own specs once a seed fixture provisions an admin.

test('landing page renders and links to sign-in', async ({ page }) => {
	await page.goto('/');

	// Branding heading is always present (defaults to "Selva" when unbranded).
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// Unauthenticated visitors get "Sign in" CTAs pointing at /login (the header
	// shows one too, hence .first()).
	const signIn = page.getByRole('link', { name: /sign in/i }).first();
	await expect(signIn).toBeVisible();
	await expect(signIn).toHaveAttribute('href', '/login');
});

test('login page renders the password form for the local provider', async ({ page }) => {
	await page.goto('/login');

	await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

	// Local provider exposes password auth: email + password fields + submit.
	await expect(page.getByLabel('Email')).toBeVisible();
	await expect(page.getByLabel('Password')).toBeVisible();
	await expect(page.getByRole('button', { name: /sign in with password/i })).toBeVisible();
});

test('a protected route redirects an unauthenticated user away', async ({ page }) => {
	await page.goto('/library');

	// Not signed in → bounced to /login (or /setup on a truly fresh instance).
	await expect(page).toHaveURL(/\/(login|setup)/);
});
