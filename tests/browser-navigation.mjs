import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:5174/");
  await page.getByRole("button", { name: "Open admin workspace" }).click();
  await page
    .getByRole("heading", { name: "Event Overview", exact: true })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  const main = page.locator(".admin-main");
  const sidebar = page.locator(".sidebar");
  const header = page.locator(".masthead");
  const before = {
    sidebar: await sidebar.boundingBox(),
    header: await header.boundingBox(),
  };
  await main.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => main.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  assert.deepEqual(await sidebar.boundingBox(), before.sidebar);
  assert.deepEqual(await header.boundingBox(), before.header);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.screenshot({ path: "test-results/admin-scroll-fixed.png" });
  await page
    .getByRole("button", { name: "Team Management", exact: true })
    .click();
  await expect.poll(() => main.evaluate((e) => e.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 1280, height: 600 });
  await sidebar.evaluate((e) => (e.scrollTop = e.scrollHeight));
  const signout = await page
    .getByRole("button", { name: "Sign out", exact: true })
    .boundingBox();
  assert(signout.y + signout.height <= 600);
  await page.setViewportSize({ width: 390, height: 844 });
  await main.evaluate((e) => (e.scrollTop = 600));
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeInViewport();
  await toggle.click();
  await expect(
    page.getByRole("dialog", { name: "Admin navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeFocused();
  const mobileBefore = await sidebar.boundingBox();
  await sidebar.hover();
  await page.mouse.wheel(0, 500);
  assert.deepEqual(await sidebar.boundingBox(), mobileBefore);
  const mainScroll = await main.evaluate((e) => e.scrollTop);
  await page.mouse.move(330, 600);
  await page.mouse.wheel(0, 500);
  assert.equal(await main.evaluate((e) => e.scrollTop), mainScroll);
  await page.screenshot({ path: "test-results/mobile-navigation-fixed.png" });
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await page
    .getByRole("button", { name: "Dismiss navigation" })
    .click({ position: { x: 350, y: 200 } });
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await page
    .getByRole("button", { name: "Reports & Export", exact: true })
    .click();
  await expect(sidebar).toBeHidden();
  await expect.poll(() => main.evaluate((e) => e.scrollTop)).toBe(0);
  await toggle.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".admin-app")).not.toHaveClass(/menu-open/);
  await expect(sidebar).toBeVisible();
  console.log(
    "Navigation checks passed: stationary shell, independent short-screen menu scrolling, page reset, mobile close/backdrop/Escape, focus, resize.",
  );
} finally {
  await browser.close();
}
