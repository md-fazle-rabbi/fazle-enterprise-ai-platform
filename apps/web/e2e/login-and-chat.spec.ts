import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Why: read from the environment, never hard-coded or committed. Set it by copying
// DEMO_USER_PASSWORD out of the repo root .env (see the README's End to end testing
// section). alice, bob and carol all share that one password.
const ALICE_PASSWORD = process.env.E2E_ALICE_PASSWORD;

// Why: the document alice's home page lists, ingested before this test runs.
const DOCUMENT_NAME = "handbook/refund-policy.md";

// Why: a question the refund-policy document answers in one sentence, so the model usually
// cites a single source like [5]. Grouped markers such as [4, 5] are not recognised as
// citations (see the README's Known limitations), so a question that invites several
// sources makes this test flaky. It is also a question not asked in manual testing, so it
// is less likely to be answered from the semantic cache.
const QUESTION = "Are shipping fees refundable?";

// Why: how long the whole pipeline (cache check, retrieval, grading, generation, output
// checks) may take before the test calls the UI stuck. Kept separate from the citation
// check so "never finished" and "finished without a citation" fail with different messages.
const PIPELINE_TIMEOUT_MS = 45_000;

// Why: the text the chat UI shows when a stream fails or ends without finishing. The
// stalled-stream test and the UI must agree on it.
const CHAT_ERROR_TEXT = /not available right now/i;

// Why: report only the rule, its impact and the failing selectors. axe's raw violation
// objects run to hundreds of lines and bury the one thing a failure needs to say.
// The scan is deliberately not narrowed with withTags() or disableRules(): a violation
// is fixed in the app, not hidden in the test.
async function expectNoAccessibilityViolations(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => String(node.target)),
  }));
  expect(summary, `accessibility violations on the ${where}`).toEqual([]);
}

// Why: both tests need the same real Keycloak login, so it lives in one place.
// Starts on the login page and ends on the signed-in home page.
async function signInFromLoginPage(page: Page): Promise<void> {
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

async function openChatAndAsk(page: Page, question: string): Promise<void> {
  await page.getByRole("link", { name: "Go to chat" }).click();
  await expect(page).toHaveURL("/chat");
  await page.getByLabel("Ask a question").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("chat end to end", () => {
  test.skip(
    !ALICE_PASSWORD,
    "Set E2E_ALICE_PASSWORD (alice's Keycloak password) to run these tests.",
  );

  test("an anonymous visitor signs in, asks a question, and gets a cited, accessible answer", async ({
    page,
  }) => {
    // 1. An anonymous visit is redirected to login by proxy.ts (micro-step 6).
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expectNoAccessibilityViolations(page, "login page");

    // 2. Sign in through the real Keycloak login form (micro-step 7's OIDC flow), then
    // check the documents panel (micro-step 8's callback, micro-step 9's panel).
    await signInFromLoginPage(page);
    // Why: .first(). The same source path can be listed more than once, and Playwright's
    // strict mode rejects a locator that matches several elements.
    await expect(page.getByText(DOCUMENT_NAME).first()).toBeVisible();

    // 3. Ask a question in chat (micro-step 12).
    await openChatAndAsk(page, QUESTION);

    // 4. The pipeline must finish: the button returns from "Thinking…" to "Send". This is
    // checked before the citation so a hung backend and a missing citation are told apart.
    await expect(
      page.getByRole("button", { name: "Send" }),
      "Pipeline did not finish: the UI is stuck on 'Thinking…'",
    ).toBeVisible({ timeout: PIPELINE_TIMEOUT_MS });

    // Why: attached to every run, so a failure shows exactly what the user would have seen.
    const conversation = page.getByRole("log", { name: "Conversation" });
    await test.info().attach("conversation.txt", {
      body: await conversation.innerText(),
      contentType: "text/plain",
    });

    // 5. The finished answer must carry a citation (micro-step 13).
    // Why: any source number plus .first(). The model may cite [4] or [5] rather than [1],
    // and several citations in one answer would otherwise trip strict mode.
    await expect(
      conversation.getByRole("link", { name: /Jump to source \d+/ }).first(),
      "Answer finished but rendered no citation link",
    ).toBeVisible();

    // The chat page with a live, cited answer is the richest state in the app and the one
    // most likely to introduce a violation the login page can't: dynamic content, inline
    // links, a sources list.
    await expectNoAccessibilityViolations(page, "chat page");
  });

  test("shows an error instead of hanging when the chat stream ends without an answer", async ({
    page,
  }) => {
    // Why: a mocked backend failure, so this test is deterministic and never calls the
    // model. It guards the bug found in the first E2E runs, where a stalled pipeline left
    // the UI on "Searching your documents…" with a disabled "Thinking…" button forever.
    // An event-stream response that ends with no events is the "stream closed before an
    // answer" case; it does not depend on the exact event format.
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: "",
      }),
    );

    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await signInFromLoginPage(page);
    await openChatAndAsk(page, QUESTION);

    // Why: filtered by text. Next.js has its own route-announcer element with role="alert",
    // so a bare getByRole("alert") would match it as well.
    await expect(
      page.getByRole("alert").filter({ hasText: CHAT_ERROR_TEXT }),
      "No error shown after the stream ended without an answer",
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Send" }),
      "Send was not re-enabled after the error",
    ).toBeEnabled();
  });
});
