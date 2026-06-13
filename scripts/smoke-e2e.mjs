import { chromium } from "playwright-core";

const SHOT = "/tmp/sdt-shots";
import { mkdirSync } from "fs";
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1480, height: 920 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${SHOT}/FAIL-${name.replace(/\W+/g, "-")}.png` });
    throw e;
  }
};

// ── 1. Home page ────────────────────────────────────────────────────────────
await step("home renders title + mode cards", async () => {
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=System Design", { timeout: 30000 });
  await page.waitForSelector("text=Startup Career");
  await page.waitForSelector("text=Incident Commander");
  await page.waitForSelector("text=Architecture Interview");
  await page.waitForSelector("text=Day One");
  await page.screenshot({ path: `${SHOT}/01-home.png` });
});

// ── 2. Start Level 1 ────────────────────────────────────────────────────────
await step("level 1 brief appears", async () => {
  await page.click("div:has-text('Day One') >> button:has-text('Play')");
  await page.waitForSelector("text=Take the helm", { timeout: 30000 });
  await page.waitForSelector("text=Hacker News");
  await page.screenshot({ path: `${SHOT}/02-brief.png` });
});

await step("canvas shows starter architecture", async () => {
  await page.click("button:has-text('Take the helm')");
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  const count = await page.locator(".react-flow__node").count();
  if (count < 3) throw new Error(`expected 3 starter nodes, got ${count}`);
  await page.screenshot({ path: `${SHOT}/03-canvas.png` });
});

// ── 3. Run the simulation ───────────────────────────────────────────────────
await step("simulation runs and produces metrics", async () => {
  await page.click("button:has-text('Launch')");
  await page.waitForSelector("text=p95 latency", { timeout: 20000 });
  // let ~25 ticks pass at 4x
  await page.click("button:has-text('4×')");
  await page.waitForTimeout(6000);
  const traffic = await page.locator("text=Traffic").first().isVisible();
  if (!traffic) throw new Error("metrics panel missing Traffic stat");
  await page.screenshot({ path: `${SHOT}/04-running.png` });
});

await step("events or mentor activity appears under load", async () => {
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${SHOT}/05-later.png` });
});

// ── 4. Inspect a node + config change while running ─────────────────────────
await step("clicking a node opens the inspector", async () => {
  await page.locator(".react-flow__node").nth(1).click();
  await page.waitForSelector("text=Instance size", { timeout: 10000 });
  await page.screenshot({ path: `${SHOT}/06-inspector.png` });
});

// ── 5. Interview mode smoke ────────────────────────────────────────────────
await step("interview mode loads and produces a report", async () => {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000); // ensure React has hydrated event handlers
  await page.click("button:has-text('Architecture Interview')");
  await page.waitForSelector("button:has-text('Begin')");
  await page.click("button:has-text('Begin')");
  await page.waitForSelector("text=Start designing", { timeout: 20000 });
  await page.click("button:has-text('Start designing')");
  await page.waitForSelector(".react-flow__node");
  await page.click("button:has-text('Submit design')");
  await page.waitForSelector("text=Interview feedback", { timeout: 30000 });
  await page.waitForSelector("text=Stress test results");
  await page.screenshot({ path: `${SHOT}/07-interview-report.png` });
});

console.log(errors.length ? `\n⚠️ browser errors:\n${[...new Set(errors)].slice(0, 8).join("\n")}` : "\n✨ no browser console errors");
await browser.close();
