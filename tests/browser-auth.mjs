// UI contract tests use intercepted Auth responses. No users/emails are created.
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const env = Object.fromEntries(
  (await readFile(".env.supabase.local", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173");
await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
await expect(
  page.getByRole("button", { name: "Open admin workspace" }),
).toHaveCount(0);
await mkdir("test-results", { recursive: true });
await page.screenshot({
  path: "test-results/live-sign-in-mobile.png",
  fullPage: true,
});
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
expect(overflow).toBe(false);

// Verify the real public configuration, without authentication or persistent writes.
const settings = await fetch(env.VITE_SUPABASE_URL + "/auth/v1/settings", {
  headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
});
const settingsBody = await settings.json();
expect(settings.status).toBe(200);
expect(settingsBody.disable_signup).toBe(true);
expect(settingsBody.external.anonymous_users).not.toBe(true);
const rpc = await fetch(env.VITE_SUPABASE_URL + "/rest/v1/rpc/call", {
  method: "POST",
  headers: {
    apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
    "Content-Profile": "api",
  },
  body: JSON.stringify({
    p_event: env.VITE_EVENT_ID,
    p_operation: "snapshot",
    p_payload: {},
  }),
});
expect([401, 403]).toContain(rpc.status);

const uid = "00000000-0000-4000-8000-000000000111";
const fid = "00000000-0000-4000-8000-000000000222";
const staff = {
  id: uid,
  name: "UI verification",
  role: "admin",
  mode: "entry",
  day: 1,
  active: true,
};
let factor = false,
  level = "aal1",
  snapshots = 0,
  updates = 0,
  signouts = 0;
const user = () => ({
  id: uid,
  email: "ui-test@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: new Date().toISOString(),
  factors: factor ? [{ id: fid, factor_type: "totp", status: "verified" }] : [],
});
const jwt = () =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: uid,
        aal: level,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        session_id: uid,
        amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
const session = () => ({
  access_token: jwt(),
  refresh_token: "test-refresh",
  token_type: "bearer",
  expires_in: 3600,
  user: user(),
});
const json = (route, data, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
await page.route(env.VITE_SUPABASE_URL + "/**", async (route) => {
  const req = route.request(),
    url = new URL(req.url());
  if (url.pathname.endsWith("/token")) return json(route, session());
  if (url.pathname.endsWith("/recover")) return json(route, {});
  if (url.pathname.endsWith("/logout")) {
    signouts++;
    return route.fulfill({ status: 204 });
  }
  if (url.pathname.endsWith("/user")) {
    if (req.method() === "PUT") updates++;
    return json(route, user());
  }
  if (url.pathname.endsWith("/factors"))
    return json(route, {
      id: fid,
      type: "totp",
      totp: {
        qr_code:
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
        secret: "TEST-SETUP-KEY",
        uri: "otpauth://totp/test",
      },
    });
  if (url.pathname.endsWith("/challenge"))
    return json(route, {
      id: "test-challenge",
      expires_at: Math.floor(Date.now() / 1000) + 120,
    });
  if (url.pathname.endsWith("/verify")) {
    if (req.postDataJSON().code !== "123456")
      return json(
        route,
        { code: "mfa_verification_failed", msg: "Invalid authenticator code" },
        422,
      );
    factor = true;
    level = "aal2";
    return json(route, session());
  }
  if (url.pathname.endsWith("/rpc/call")) {
    const op = req.postDataJSON().p_operation;
    if (op === "context") return json(route, staff);
    if (op === "snapshot") {
      snapshots++;
      if (level !== "aal2")
        return json(
          route,
          { message: "MFA_REQUIRED|Verification required" },
          400,
        );
      return json(route, {
        teams: [],
        claims: [],
        staff: [staff],
        schedules: [],
        audit: [],
        serverTime: new Date().toISOString(),
      });
    }
  }
  throw new Error("Unmocked request: " + url.pathname);
});
await page.getByLabel("Email", { exact: true }).fill("ui-test@example.invalid");
await page.getByLabel("Password", { exact: true }).fill("Test-only-password");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await expect(
  page.getByRole("button", { name: "Set up authenticator" }),
).toBeVisible();
expect(snapshots).toBe(0);
await page.getByRole("button", { name: "Set up authenticator" }).click();
await expect(
  page.getByRole("img", { name: "Authenticator setup QR code" }),
).toBeVisible();
await page.getByLabel("Authenticator code").fill("000000");
await page.getByRole("button", { name: "Verify and continue" }).click();
await expect(page.getByRole("alert")).toContainText(
  "Invalid authenticator code",
);
expect(snapshots).toBe(0);
await page.getByLabel("Authenticator code").fill("123456");
await page.getByRole("button", { name: "Verify and continue" }).click();
await expect(
  page.getByRole("heading", { name: "Event Overview", exact: true }),
).toBeVisible();
expect(snapshots).toBeGreaterThan(0);
await page.reload();
await expect(
  page.getByRole("heading", { name: "Event Overview", exact: true }),
).toBeVisible();
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole("button", { name: "Sign out", exact: true }).click();
await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
expect(signouts).toBe(1);
await page.getByRole("button", { name: "Forgot password?" }).click();
await expect(
  page.getByRole("heading", { name: "Account recovery" }),
).toBeVisible();
await expect(
  page.getByText(
    "Contact the event organizer to restore access to your staff account.",
  ),
).toBeVisible();
await expect(page.getByRole("button", { name: "Send reset link" })).toHaveCount(
  0,
);

// A recovery callback must lead to password entry, never a dashboard.
const recovery = new URL("http://127.0.0.1:5173");
recovery.hash = new URLSearchParams({
  access_token: jwt(),
  refresh_token: "test-refresh",
  expires_in: "3600",
  token_type: "bearer",
  type: "recovery",
}).toString();
await page.goto("about:blank");
await page.goto(recovery.href);
await expect(
  page.getByRole("heading", { name: "Choose a new password" }),
).toBeVisible();
await page
  .getByLabel("New password", { exact: true })
  .fill("New-test-only-password");
await page
  .getByLabel("Confirm password", { exact: true })
  .fill("Different-test-password");
await page.getByRole("button", { name: "Save password" }).click();
await expect(page.getByRole("alert")).toContainText("do not match");
expect(updates).toBe(0);
await page
  .getByLabel("Confirm password", { exact: true })
  .fill("New-test-only-password");
await page.getByRole("button", { name: "Save password" }).click();
await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
expect(updates).toBe(1);
expect(signouts).toBe(2);
expect(errors).toEqual([]);
await browser.close();
console.log(
  "PASS: live configuration and anonymous rejection; mocked Auth enrollment, invalid/valid MFA, restore, logout, recovery and password confirmation.",
);
