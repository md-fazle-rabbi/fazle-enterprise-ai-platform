import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Why: read from the environment, never hard-coded or committed. playwright.config.ts fills it
// from DEMO_USER_PASSWORD in the repo root .env. alice, bob and carol share that one password.
export const ALICE_PASSWORD = process.env.E2E_ALICE_PASSWORD;

// Why: report only the rule, its impact and the failing selectors. axe's raw violation
// objects run to hundreds of lines and bury the one thing a failure needs to say.
// The scan is deliberately not narrowed with withTags() or disableRules(): a violation
// is fixed in the app, not hidden in the test.
export async function expectNoAccessibilityViolations(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => String(node.target)),
  }));
  expect(summary, `accessibility violations on the ${where}`).toEqual([]);
}

// Why: a real Keycloak login. Starts on any page, ends on the signed in home page.
export async function signInAsAlice(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("link", { name: "Sign in with Keycloak" }).click();
  await expect(page).toHaveURL(/localhost:8080/);
  // Why: id selectors, not accessible names. Keycloak's default theme labels the username
  // field "Username", "Username or email" or "Email" depending on realm settings, but the
  // field's id stays "username" across all of them.
  await page.locator("#username").fill("alice");
  await page.locator("#password").fill(ALICE_PASSWORD ?? "");
  await page.locator("#kc-login").click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Signed in as alice" })).toBeVisible();
}
