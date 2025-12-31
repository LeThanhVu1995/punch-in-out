const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const {
    MODE = "IN",
    LOGIN_URL,
    TARGET_URL,

    // login selectors
    USERNAME_SELECTOR,
    PASSWORD_SELECTOR,
    SUBMIT_SELECTOR,

    // punch selectors
    BUTTON_IN_SELECTOR,
    BUTTON_OUT_SELECTOR,

    // multi-users
    ACCOUNTS_FILE = "accounts.json",

    // optional
    LIMIT = "9999",
  } = process.env;

  const buttonSelector = MODE === "OUT" ? BUTTON_OUT_SELECTOR : BUTTON_IN_SELECTOR;

  const must = [
    ["LOGIN_URL", LOGIN_URL],
    ["TARGET_URL", TARGET_URL],
    ["USERNAME_SELECTOR", USERNAME_SELECTOR],
    ["PASSWORD_SELECTOR", PASSWORD_SELECTOR],
    ["SUBMIT_SELECTOR", SUBMIT_SELECTOR],
    ["BUTTON_SELECTOR", buttonSelector],
  ];
  for (const [k, v] of must) {
    if (!v) throw new Error(`Missing env: ${k}`);
  }

  if (!fs.existsSync(ACCOUNTS_FILE)) {
    throw new Error(`Missing accounts file: ${ACCOUNTS_FILE}`);
  }

  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8"));
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("accounts.json is empty or invalid");
  }

  const max = Math.min(parseInt(LIMIT, 10) || accounts.length, accounts.length);
  const targets = accounts.slice(0, max);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    console.log("MODE =", MODE);
    console.log("Accounts =", targets.length);

    for (const acc of targets) {
      const userTag = String(acc.username || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
      const username = acc.username;
      const password = acc.password;

      if (!username || !password) {
        results.push({ user: userTag, ok: false, error: "Missing username/password in accounts.json" });
        continue;
      }

      // Tách session mỗi user
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);

      try {
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
        await page.screenshot({ path: `01-login-${MODE}-${userTag}.png`, fullPage: true });

        async function fillSmart(selector, value, label) {
          const loc = page.locator(selector).first();
          try {
            await loc.waitFor({ state: "visible", timeout: 30000 });
            await loc.fill(value);
            return;
          } catch {}

          for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            try {
              const floc = frame.locator(selector).first();
              await floc.waitFor({ state: "visible", timeout: 5000 });
              await floc.fill(value);
              return;
            } catch {}
          }

          await page.screenshot({ path: `02-missing-${label}-${MODE}-${userTag}.png`, fullPage: true });
          throw new Error(`Cannot find visible ${label} with selector: ${selector}`);
        }

        await fillSmart(USERNAME_SELECTOR, username, "username");
        await fillSmart(PASSWORD_SELECTOR, password, "password");

        await Promise.all([
          page.waitForLoadState("networkidle"),
          page.click(SUBMIT_SELECTOR),
        ]);

        await page.screenshot({ path: `03-after-login-${MODE}-${userTag}.png`, fullPage: true });

        await page.goto(TARGET_URL, { waitUntil: "networkidle" });
        await page.screenshot({ path: `04-target-${MODE}-${userTag}.png`, fullPage: true });

        await page.click(buttonSelector);
        await page.screenshot({ path: `05-after-click-${MODE}-${userTag}.png`, fullPage: true });

        console.log(`✅ ${userTag}: ${MODE} clicked`);
        results.push({ user: userTag, ok: true });
      } catch (e) {
        console.error(`❌ ${userTag}:`, e);

        const html = await page.content().catch(() => "");
        fs.writeFileSync(`debug-${MODE}-${userTag}.html`, html || "");
        await page.screenshot({ path: `error-${MODE}-${userTag}.png`, fullPage: true });

        results.push({ user: userTag, ok: false, error: String(e) });
      } finally {
        await context.close();
      }
    }

    fs.writeFileSync("results.json", JSON.stringify(results, null, 2), "utf-8");
    console.log("Saved results.json");
  } finally {
    await browser.close();
  }
})();
