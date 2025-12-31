const { chromium } = require("playwright");

(async () => {
  const {
    MODE,
    LOGIN_URL,
    TARGET_URL,
    USERNAME,
    PASSWORD,
    USERNAME_SELECTOR,
    PASSWORD_SELECTOR,
    SUBMIT_SELECTOR,
    BUTTON_IN_SELECTOR,
    BUTTON_OUT_SELECTOR,
  } = process.env;

  const buttonSelector = MODE === "OUT" ? BUTTON_OUT_SELECTOR : BUTTON_IN_SELECTOR;

  const must = [
    ["LOGIN_URL", LOGIN_URL],
    ["TARGET_URL", TARGET_URL],
    ["USERNAME", USERNAME],
    ["PASSWORD", PASSWORD],
    ["USERNAME_SELECTOR", USERNAME_SELECTOR],
    ["PASSWORD_SELECTOR", PASSWORD_SELECTOR],
    ["SUBMIT_SELECTOR", SUBMIT_SELECTOR],
    ["BUTTON_SELECTOR", buttonSelector],
  ];
  for (const [k, v] of must) {
    if (!v) throw new Error(`Missing env: ${k}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Tăng timeout tổng cho môi trường CI (nếu mạng chậm)
  page.setDefaultTimeout(60000);

  try {
    console.log("MODE =", MODE);
    console.log("Go login:", LOGIN_URL);

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    console.log("Current URL after goto:", page.url());

    // Chụp ngay sau khi vào login để xem có bị redirect/captcha không
    await page.screenshot({ path: "01-login-page.png", fullPage: true });

    // Helper: fill trong main page, nếu fail thì thử tìm trong iframe
    async function fillSmart(selector, value, label) {
      // 1) thử ở main document
      const loc = page.locator(selector).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 30000 });
        await loc.fill(value);
        console.log(`Filled ${label} in main page`);
        return;
      } catch (e) {
        console.log(`Main page fill failed for ${label}. Trying frames...`);
      }

      // 2) thử trong frames
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const floc = frame.locator(selector).first();
          await floc.waitFor({ state: "visible", timeout: 5000 });
          await floc.fill(value);
          console.log(`Filled ${label} in frame:`, frame.url());
          return;
        } catch {}
      }

      // 3) debug thêm
      await page.screenshot({ path: `02-missing-${label}.png`, fullPage: true });
      throw new Error(`Cannot find visible ${label} with selector: ${selector}`);
    }

    await fillSmart(USERNAME_SELECTOR, USERNAME, "username");
    await fillSmart(PASSWORD_SELECTOR, PASSWORD, "password");

    console.log("Click submit...");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click(SUBMIT_SELECTOR),
    ]);

    console.log("URL after submit:", page.url());
    await page.screenshot({ path: "03-after-login.png", fullPage: true });

    console.log("Go target:", TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: "networkidle" });
    await page.screenshot({ path: "04-target.png", fullPage: true });

    console.log("Click button:", MODE);
    await page.click(buttonSelector);
    await page.screenshot({ path: "05-after-click.png", fullPage: true });

    console.log(`✅ Done: ${MODE} clicked`);
  } catch (e) {
    console.error("❌ Failed:", e);
    // lưu HTML để soi DOM
    const html = await page.content().catch(() => "");
    require("fs").writeFileSync("debug.html", html || "");
    await page.screenshot({ path: `error-${MODE}-${Date.now()}.png`, fullPage: true });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
