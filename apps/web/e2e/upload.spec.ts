import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ALICE_PASSWORD, expectNoAccessibilityViolations, signInAsAlice } from "./helpers";

// Why: set E2E_PROOF_DIR=../../proof to save screenshots of the finished states there. It is
// off by default, so an ordinary run never rewrites the committed images.
const PROOF_DIR = process.env.E2E_PROOF_DIR;

async function saveProof(page: Page, name: string): Promise<void> {
  if (PROOF_DIR) {
    await page.screenshot({ path: path.join(PROOF_DIR, name), fullPage: true });
  }
}

// Why: filtered by text. Other parts of the page may use role="status" or role="alert" (the
// Next.js route announcer does), so a bare role query could match the wrong element.
const statusWith = (page: Page, text: string | RegExp) =>
  page.getByRole("status").filter({ hasText: text });
const alertWith = (page: Page, text: string | RegExp) =>
  page.getByRole("alert").filter({ hasText: text });

async function choose(page: Page, file: { name: string; mimeType: string; body: string }) {
  await page.getByLabel("Choose a file").setInputFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.body),
  });
}

test.describe("document upload end to end", () => {
  test.skip(
    !ALICE_PASSWORD,
    "Set E2E_ALICE_PASSWORD (alice's Keycloak password) to run these tests.",
  );

  test("alice uploads a text file, sees it listed, and a repeat is recognised", async ({
    page,
  }) => {
    // Why: a new name and content every run, so the file is never a duplicate of an old run
    // and the "stored" answer is the one under test. The text is plain business prose, so
    // the injection firewall has nothing to flag.
    const stamp = Date.now();
    const name = `e2e-upload-${stamp}.md`;
    const body = `# E2E upload note\n\nRun ${stamp}. Shipping fees are listed on the invoice.\n`;

    await signInAsAlice(page);
    await expect(page.getByRole("heading", { name: "Upload a document" })).toBeVisible();
    await expectNoAccessibilityViolations(page, "home page with the upload form");

    await choose(page, { name, mimeType: "text/markdown", body });
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(
      statusWith(page, `${name} was stored in`),
      "The upload did not finish with a stored message",
    ).toBeVisible({ timeout: 60_000 });
    // Why: the list is re-read by router.refresh(), with no page reload.
    await expect(
      page.getByRole("listitem").filter({ hasText: name }),
      "The new document is not in the list",
    ).toBeVisible();
    await saveProof(page, "web-upload-success.png");
    await expectNoAccessibilityViolations(page, "home page after an upload");

    // The same content again is recognised, not stored twice.
    await choose(page, { name, mimeType: "text/markdown", body });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(statusWith(page, `${name} is already stored with the same content.`)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("shows the reason when a file type is refused", async ({ page }) => {
    await signInAsAlice(page);
    await choose(page, {
      name: "setup.exe",
      mimeType: "application/octet-stream",
      body: "MZ fake",
    });
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(alertWith(page, /not supported/i)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "setup.exe" })).toHaveCount(0);
    await saveProof(page, "web-upload-refused.png");
    await expectNoAccessibilityViolations(page, "home page after a refused upload");
  });

  test("asks for a file before uploading", async ({ page }) => {
    await signInAsAlice(page);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(alertWith(page, "Choose a file before uploading.")).toBeVisible();
  });

  test("shows a rate limit answer with its message", async ({ page }) => {
    // Why: mocked, so this test is deterministic and never spends the real upload budget.
    await page.route("**/api/documents", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "42" },
        body: JSON.stringify({
          code: "rate_limited",
          message: "Too many uploads. Try again in 42 seconds.",
          retryAfterSeconds: 42,
        }),
      }),
    );
    await signInAsAlice(page);
    await choose(page, { name: "note.md", mimeType: "text/markdown", body: "hello" });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(alertWith(page, "Too many uploads. Try again in 42 seconds.")).toBeVisible();
    await expectNoAccessibilityViolations(page, "home page after a rate limit answer");
  });

  test("shows progress while a slow upload runs", async ({ page }) => {
    await page.route("**/api/documents", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          kind: "text",
          documentId: "22222222-2222-4222-8222-222222222222",
          deduplicated: false,
          chunkCount: 2,
        }),
      });
    });
    await signInAsAlice(page);
    await choose(page, { name: "slow.md", mimeType: "text/markdown", body: "hello" });
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(page.getByRole("button", { name: "Uploading…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(statusWith(page, /A PDF can take a few minutes/)).toBeVisible();
    await expectNoAccessibilityViolations(page, "home page while an upload runs");
    await expect(statusWith(page, "slow.md was stored in 2 chunks.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  });
});
