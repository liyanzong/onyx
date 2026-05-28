/**
 * Playwright E2E tests for the Craft "subagents view" feature.
 *
 * When a subagent is dispatched (a parent `task` tool call), an "Agents" strip
 * appears above the chat input with one pill per subagent. Clicking a pill
 * opens a transient side-panel tab whose body renders the subagent's own tool
 * calls. The main chat transcript stays visible. Closing the tab keeps the pill.
 *
 * Conventions (login helper, persona cookie, /craft/v1 navigation, route
 * mocking) mirror the chat E2E specs. Driving a real subagent is flaky
 * (model/sandbox/onboarding), so the send-message stream is fully mocked with
 * the exact SSE wire format processSSEStream parses: per-line
 * `event: message` / `data: {json}` frames. Session creation + the initial
 * session GET are mocked too so the home-input send can fire without a live
 * sandbox.
 *
 * Covers:
 * 1. After submitting, the "Agents" strip is visible with >=1 pill.
 * 2. Clicking the pill opens a subagent panel tab; the body shows the child
 *    tool-call command text.
 * 3. The originally-typed prompt remains visible in the main chat.
 * 4. Closing the tab (the x on the tab) removes the tab but the strip pill
 *    remains.
 */

import { test, expect, Page } from "@playwright/test";
import { loginAsWorkerUser } from "@tests/e2e/utils/auth";

// ---------------------------------------------------------------------------
// Constants — must line up across the mocked frames so the frontend's subagent
// routing (parentSessionId/sessionId/subagentSessionId) links everything up.
// ---------------------------------------------------------------------------

const FAKE_SESSION_ID = "e2e-test-session-subagents";
const PARENT_SESSION = "ses_parent";
const CHILD_SESSION = "ses_child_1";
const SUBAGENT_TYPE = "general";
const CHILD_COMMAND = "grep -r auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed the build_user_persona cookie so the onboarding modal never blocks. */
async function seedPersonaCookie(page: Page): Promise<void> {
  const url = new URL(page.url());
  const domain = url.hostname || "localhost";
  await page.context().addCookies([
    {
      name: "build_user_persona",
      value: encodeURIComponent(
        JSON.stringify({ workArea: "engineering", level: "ic" })
      ),
      domain,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    },
  ]);
}

/**
 * Navigate to Craft and seed the persona cookie.
 * Returns false if Craft is not enabled (redirect to /app).
 */
async function gotocraft(page: Page): Promise<boolean> {
  await page.goto("/");
  await seedPersonaCookie(page);
  await page.goto("/craft/v1");
  await page.waitForLoadState("networkidle");
  return new URL(page.url()).pathname.startsWith("/craft");
}

/**
 * Build the mocked SSE stream body. processSSEStream parses line-by-line:
 * `event: message` sets the event type, `data: {json}` carries the packet
 * (data.type is the real packet type). Frames are separated by a blank line.
 */
function sseBody(frames: Record<string, unknown>[]): string {
  return (
    frames
      .map((f) => `event: message\ndata: ${JSON.stringify(f)}\n`)
      .join("\n") + "\n"
  );
}

/**
 * Register the route mocks needed for a send to fire without a live sandbox:
 *   - POST /api/build/sessions          -> returns FAKE_SESSION_ID
 *   - GET  /api/build/sessions          -> empty history list
 *   - GET  /api/build/sessions/:id      -> minimal idle session
 *   - POST /api/build/sessions/:id/send-message -> the subagent SSE stream
 */
async function mockSubagentStream(page: Page): Promise<void> {
  await page.route("**/api/build/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: FAKE_SESSION_ID,
          status: "idle",
          created_at: new Date().toISOString(),
          sandbox: { nextjs_port: null },
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }
  });

  await page.route(
    `**/api/build/sessions/${FAKE_SESSION_ID}`,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: FAKE_SESSION_ID,
            status: "idle",
            created_at: new Date().toISOString(),
            sandbox: { nextjs_port: null },
            messages: [],
            artifacts: [],
          }),
        });
      } else {
        await route.continue();
      }
    }
  );

  await page.route(
    `**/api/build/sessions/${FAKE_SESSION_ID}/send-message`,
    async (route) => {
      const frames: Record<string, unknown>[] = [
        // 1. Parent `task` tool call (completed) — seeds the subagent pill.
        {
          type: "tool_call_progress",
          toolCallId: "toolu_task1",
          kind: "other",
          status: "completed",
          title: "Running task",
          rawInput: {
            description: "explore",
            prompt: "Explore the auth code",
            subagent_type: SUBAGENT_TYPE,
          },
          _meta: {
            toolName: "task",
            subagentSessionId: CHILD_SESSION,
          },
        },
        // 2. Child tool-call start (subagent-internal bash command).
        {
          type: "tool_call_start",
          toolCallId: "toolu_child1",
          kind: "execute",
          title: "Running command",
          _meta: {
            toolName: "bash",
            sessionId: CHILD_SESSION,
            parentSessionId: PARENT_SESSION,
          },
        },
        // 3. Child tool-call progress (completed) — renders in the panel body.
        {
          type: "tool_call_progress",
          toolCallId: "toolu_child1",
          kind: "execute",
          status: "completed",
          title: "Running command",
          rawInput: { command: CHILD_COMMAND, description: "search auth" },
          rawOutput: "...match...",
          _meta: {
            toolName: "bash",
            sessionId: CHILD_SESSION,
            parentSessionId: PARENT_SESSION,
          },
        },
        // 4. Turn terminator.
        { type: "prompt_response", stopReason: "end_turn" },
      ];
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody(frames),
      });
    }
  );
}

/** The "Agents" strip rendered above the input when a subagent exists. */
function agentStrip(page: Page) {
  return page.getByRole("region", { name: /agents/i });
}

/** An agent pill: button labeled "View subagent transcript: ...". */
function agentPill(page: Page) {
  return page.getByRole("button", { name: /view subagent transcript/i });
}

/** Submit the home-input prompt and wait for the session id to land in URL. */
async function submitPrompt(page: Page, prompt: string): Promise<void> {
  const messageInput = page.getByRole("textbox", { name: "Message input" });
  await expect(messageInput).toBeVisible({ timeout: 20000 });
  await messageInput.click();
  await messageInput.fill(prompt);
  await page.keyboard.press("Enter");

  await page.waitForFunction(
    () => window.location.href.includes("sessionId="),
    null,
    { timeout: 30000 }
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Craft subagents view", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginAsWorkerUser(page, testInfo.workerIndex);
  });

  test("agent strip appears with a pill, opens a subagent panel tab, and closing the tab keeps the pill", async ({
    page,
  }) => {
    const craftEnabled = await gotocraft(page);
    test.skip(!craftEnabled, "Onyx Craft is not enabled in this environment");

    await mockSubagentStream(page);

    const PROMPT = "investigate the auth flow";
    await submitPrompt(page, PROMPT);

    // (1) The "Agents" strip is visible with >=1 pill.
    await expect(agentStrip(page)).toBeVisible({ timeout: 15000 });
    const pill = agentPill(page).first();
    await expect(pill).toBeVisible({ timeout: 5000 });

    // (3) The originally-typed prompt is still visible in the main chat.
    await expect(page.getByText(PROMPT, { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });

    // (2) Clicking the pill opens a transient side-panel tab whose body shows
    //     the child command text.
    await pill.click();

    // The tab's close button is labeled "Close <name>" (name falls back to the
    // subagent type when the task has no first-line command).
    const closeTabBtn = page.getByRole("button", {
      name: new RegExp(`close ${SUBAGENT_TYPE}`, "i"),
    });
    await expect(closeTabBtn).toBeVisible({ timeout: 8000 });

    // Panel body renders the subagent's tool call: command text + title.
    await expect(
      page.getByText("Running command", { exact: false }).first()
    ).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/grep/i).first()).toBeVisible({
      timeout: 8000,
    });

    // Main chat transcript still visible alongside the panel.
    await expect(
      page.getByText(PROMPT, { exact: false }).first()
    ).toBeVisible();

    // (4) Closing the tab removes it but the strip pill remains.
    await closeTabBtn.click();
    await expect(closeTabBtn).not.toBeVisible({ timeout: 5000 });
    await expect(agentStrip(page)).toBeVisible();
    await expect(agentPill(page).first()).toBeVisible();
  });
});
