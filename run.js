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
  if (!LOGIN_URL || !TARGET_URL || !USERNAME || !PASSWORD) throw new Error("Missing LOGIN_URL/TARGET_URL/USERNAME/PASSWORD");
  if (!USERNAME_SELECTOR || !PASSWORD_SELECTOR || !SUBMIT_SELECTOR) throw new Error("Missing selectors for login");
  if (!buttonSelector) throw new Error("Missing button selector for MODE=" + MODE);

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.fill(USERNAME_SELECTOR, USERNAME);
    await page.fill(PASSWORD_SELECTOR, PASSWORD);

    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click(SUBMIT_SELECTOR),
    ]);

    await page.goto(TARGET_URL, { waitUntil: "networkidle" });
    await page.click(buttonSelector);

    console.log(`✅ Done: ${MODE} clicked`);
  } catch (e) {
    console.error("❌ Failed:", e);
    await page.screenshot({ path: `error-${MODE}-${Date.now()}.png`, fullPage: true });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
