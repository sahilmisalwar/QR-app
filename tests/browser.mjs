import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1536, height: 1040 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5174/");
await page.getByRole("button", { name: "Open admin workspace" }).click();
await page
  .getByRole("heading", { name: "Event Overview", exact: true })
  .waitFor();
await page.screenshot({
  path: "test-results/admin-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Team Management", exact: true })
  .click();
await page.getByRole("textbox", { name: "Search teams" }).fill("C-080");
await page.getByRole("button", { name: "Pass", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("img", { name: "QR pass for C-080" }).waitFor();
await page.screenshot({ path: "test-results/pass.png" });
await page.getByRole("button", { name: "Close dialog" }).click();
await page
  .getByRole("button", { name: "Event Operations", exact: true })
  .click();
await page.screenshot({ path: "test-results/operations.png", fullPage: true });
await page.getByRole("button", { name: "Sign out", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Lunch", exact: true }).click();
await page
  .getByRole("heading", { name: "Lunch Check-in", exact: true })
  .waitFor();
await page.screenshot({
  path: "test-results/volunteer-lunch.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Open Scanner" }).click();
await page.getByRole("button", { name: "Unclaimed team" }).click();
await page.getByRole("heading", { name: "Verify team members" }).waitFor();
const confirm = page.getByRole("button", {
  name: "Confirm Lunch Check-in",
  exact: true,
});
if (await confirm.isEnabled())
  throw Error("Meal confirmation must require full-team attestation");
await page.screenshot({ path: "test-results/verify.png", fullPage: true });
await page.getByRole("checkbox").check();
await confirm.click();
await page.getByRole("heading", { name: "Check-in Successful!" }).waitFor();
await page.getByRole("button", { name: "Scan Next Team" }).click();
await page.getByRole("button", { name: "Unclaimed team" }).click();
await page.getByRole("heading", { name: "Already Checked In" }).waitFor();
await page.screenshot({ path: "test-results/duplicate.png", fullPage: true });
await page.getByRole("button", { name: "Back to dashboard" }).click();
await page.getByRole("button", { name: "Profile", exact: true }).click();
await page.getByRole("button", { name: "Sign out of station" }).click();
for (const mode of ["Entry", "Dinner"]) {
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page
    .getByRole("heading", { name: mode + " Check-in", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/volunteer-" + mode.toLowerCase() + ".png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile horizontal overflow in " + mode);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("button", { name: "Sign out of station" }).click();
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  "Browser flow passed: admin, search, QR pass, operations, mobile checkpoints, human confirmation and duplicate prevention.",
);
await browser.close();
