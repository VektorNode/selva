import { expect, test } from '@playwright/test';

// Smoke flows over the public surface, signed out. They run after the `setup`
// project has created the admin: until one exists, /login redirects to /setup.

test('landing page renders and links to sign-in', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// .first() because the header shows its own "Sign in" link too.
	const signIn = page.getByRole('link', { name: /sign in/i }).first();
	await expect(signIn).toBeVisible();
	await expect(signIn).toHaveAttribute('href', '/login');
});

test('login page renders the password form for the local provider', async ({ page }) => {
	await page.goto('/login');

	await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

	await expect(page.getByLabel('Email')).toBeVisible();
	await expect(page.getByLabel('Password')).toBeVisible();
	await expect(page.getByRole('button', { name: /sign in with password/i })).toBeVisible();
});

test('a protected route redirects an unauthenticated user away', async ({ page }) => {
	await page.goto('/library');

	await expect(page).toHaveURL(/\/login/);
});
