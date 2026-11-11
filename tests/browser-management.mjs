import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5174/");
await page.getByRole("button", { name: "Open admin workspace" }).click();
await page.getByRole("button", { name: "Add New Team", exact: true }).click();
await page.getByRole("textbox", { name: "Team ID", exact: true }).fill("A-999");
await page
  .getByRole("textbox", { name: "Team name", exact: true })
  .fill("Browser Test Team");
await page
  .getByRole("textbox", { name: "College", exact: true })
  .fill("Test Institute");
await page
  .getByRole("textbox", { name: /Members/ })
  .fill("Test Member One\nTest Member Two");
await page.getByRole("button", { name: "Save team", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await page.getByRole("button", { name: "QR Passes", exact: true }).click();
await page.getByRole("textbox", { name: "Search teams" }).fill("A-999");
await page.getByRole("button", { name: "Pass", exact: true }).click();
const qr = page.getByRole("img", { name: "QR pass for A-999" });
const imageData = await qr.getAttribute("src");
if (!imageData?.startsWith("data:image/png"))
  throw Error("Expected a generated QR PNG");
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Sign out", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Lunch", exact: true }).click();
await page.getByRole("button", { name: "Open Scanner" }).click();
await page
  .locator("input[type=file]")
  .setInputFiles({
    name: "team-pass.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageData.split(",")[1], "base64"),
  });
await page
  .getByRole("heading", { name: "Browser Test Team", exact: true })
  .waitFor();
await page.getByRole("checkbox").check();
await page.getByRole("button", { name: "Confirm Lunch Check-in" }).click();
await page.getByRole("heading", { name: "Check-in Successful!" }).waitFor();
await page.getByRole("button", { name: "Back to dashboard" }).click();
await page.getByRole("button", { name: "Profile", exact: true }).click();
await page.getByRole("button", { name: "Sign out of station" }).click();
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: "Open admin workspace" }).click();
await page
  .getByRole("button", { name: "Scanning History", exact: true })
  .click();
await page.getByRole("textbox", { name: "Search history" }).fill("A-999");
await page.getByRole("button", { name: "Correct", exact: true }).click();
await page
  .getByRole("textbox", { name: "Correction reason" })
  .fill("Browser verification correction");
await page.getByRole("button", { name: "Confirm reversal" }).click();
await expect(page.getByText("Reversed", { exact: true })).toBeVisible();
const downloaded = page.waitForEvent("download");
await page.getByRole("button", { name: "Export this view" }).click();
await (await downloaded).saveAs("test-results/checkins.csv");
await page
  .getByRole("button", { name: "Team Management", exact: true })
  .click();
await page
  .locator("input[type=file]")
  .setInputFiles({
    name: "teams.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "code,name,college,category,members\nB-999,Imported Test Team,Example College,B,One|Two",
    ),
  });
await page.getByRole("button", { name: "Confirm import", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await page.getByRole("textbox", { name: "Search teams" }).fill("B-999");
await expect(
  page.getByText("Imported Test Team", { exact: true }),
).toBeVisible();
await page.setViewportSize({ width: 390, height: 844 });
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw Error("Admin mobile horizontal overflow");
await page.screenshot({
  path: "test-results/admin-mobile.png",
  fullPage: true,
});
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "Management flow passed: new team, real QR image decoding, explicit confirmation, correction, CSV export/import and mobile layout.",
);
await browser.close();
