const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const {loadAccounts} = require("./service/accounts");
const {prepareVerification} = require("./service/verification");

const diagnostics=process.env.PUNCH_DIAGNOSTICS==="1";
const log=(...args)=>{if(diagnostics)console.log(...args);};
const logError=(...args)=>{if(diagnostics)console.error(...args);};
async function screenshot(page,options){if(diagnostics)return page.screenshot(options);}
function progress(phase, details = {}) {
  if(!diagnostics)details={verification:details.verification?{verified:!!details.verification.verified}:undefined,
    reason:details.reason?"Attendance attempt could not be verified; check connectivity and account settings.":undefined};
  if (!process.env.ATTEMPT_PROGRESS_FILE) return;
  const file = process.env.ATTEMPT_PROGRESS_FILE;
  fs.writeFileSync(file + ".tmp", JSON.stringify({phase, ...details, at:new Date().toISOString()}));
  fs.renameSync(file + ".tmp", file);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function safeTag(s) {
  return String(s || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readJsonFile(filePath, fallback) {
  try {
    if (!filePath) return fallback;
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return fallback;
    return JSON.parse(fs.readFileSync(abs, "utf-8"));
  } catch (e) {
    throw new Error(`Invalid JSON in file: ${filePath} (${e.message})`);
  }
}

function todayYMD(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isWeekendInTZ(timeZone) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(new Date())
    .toLowerCase();
  return weekday.startsWith("sat") || weekday.startsWith("sun");
}

function clampDelayCfg(cfg) {
  const startMin = Number.isFinite(cfg?.startDelayMinSec) ? cfg.startDelayMinSec : 0;
  const startMax = Number.isFinite(cfg?.startDelayMaxSec) ? cfg.startDelayMaxSec : 0;
  const betweenMin = Number.isFinite(cfg?.betweenUsersMinSec) ? cfg.betweenUsersMinSec : 0;
  const betweenMax = Number.isFinite(cfg?.betweenUsersMaxSec) ? cfg.betweenUsersMaxSec : 0;

  return {
    startMin: Math.max(0, startMin),
    startMax: Math.max(0, startMax),
    betweenMin: Math.max(0, betweenMin),
    betweenMax: Math.max(0, betweenMax),
  };
}

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

    // multi-users (file)
    ACCOUNTS_FILE = "accounts.json",

    // config file (off days + delay)
    OFF_DAYS_FILE = "off_days.json",

    // optional
    LIMIT = "9999",
  } = process.env;

  const verificationConfig = JSON.parse(process.env.PUNCH_VERIFICATION || '{"mode":"none"}');
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

  // Load accounts
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    throw new Error(`Missing accounts file: ${ACCOUNTS_FILE}`);
  }
  const accounts = loadAccounts(ACCOUNTS_FILE).filter(account=>account.enabled!==false);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("accounts.json is empty or invalid");
  }

  const max = Math.min(parseInt(LIMIT, 10) || accounts.length, accounts.length);
  const targets = accounts.slice(0, max).filter(acc => !process.env.ACCOUNT_USERNAME || acc.username === process.env.ACCOUNT_USERNAME);

  /**
   * off_days.json format:
   * {
   *   "timezone": "Asia/Ho_Chi_Minh",
   *   "skipWeekends": true,
   *   "global": ["2026-01-01"],
   *   "users": { "test01": ["2026-01-06"] },
   *
   *   // ✅ delay config (seconds)
   *   "startDelayMinSec": 0,
   *   "startDelayMaxSec": 60,
   *   "betweenUsersMinSec": 1,
   *   "betweenUsersMaxSec": 5
   * }
   */
  const offCfg = readJsonFile(OFF_DAYS_FILE, {});
  const timeZone = offCfg.timezone || "Asia/Ho_Chi_Minh";
  const skipWeekends = offCfg.skipWeekends !== false; // default true
  const globalOff = Array.isArray(offCfg.global) ? offCfg.global : [];
  const usersOff = offCfg.users && typeof offCfg.users === "object" ? offCfg.users : {};

  // ✅ delay config from file
  const delayCfg = clampDelayCfg(offCfg);

  const today = todayYMD(timeZone);
  const weekend = isWeekendInTZ(timeZone);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    log("MODE =", MODE);
    log("Accounts =", targets.length);
    log("TIMEZONE =", timeZone);
    log("TODAY =", today);
    log("SKIP_WEEKENDS =", skipWeekends);
    log("DELAY =", delayCfg);

    // ✅ Random start delay
    if (delayCfg.startMax > 0 && delayCfg.startMax >= delayCfg.startMin) {
      const s = randInt(delayCfg.startMin, delayCfg.startMax);
      log(`Start delay: ${s}s`);
      await sleep(s * 1000);
    }

    for (let idx = 0; idx < targets.length; idx++) {
      const acc = targets[idx];
      const username = acc.username;
      const password = acc.password;
      const userTag = safeTag(username);

      if (!username || !password) {
        results.push({ user: userTag, ok: false, error: "Missing username/password in accounts.json" });
        continue;
      }

      // ✅ Skip rules
      if (skipWeekends && weekend) {
        log(`⏭️  Skip ${username}: weekend (${today})`);
        results.push({ user: userTag, ok: true, skipped: true, reason: "weekend", date: today });
        continue;
      }

      if (globalOff.includes(today)) {
        log(`⏭️  Skip ${username}: global off day (${today})`);
        results.push({ user: userTag, ok: true, skipped: true, reason: "global_off", date: today });
        continue;
      }

      const userOffList = usersOff[username] || usersOff[userTag] || [];
      if (Array.isArray(userOffList) && userOffList.includes(today)) {
        log(`⏭️  Skip ${username}: user off day (${today})`);
        results.push({ user: userTag, ok: true, skipped: true, reason: "user_off", date: today });
        continue;
      }

      // Tách session mỗi user
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);

      let phase = "before_click";
      try {
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
        await screenshot(page,{ path: `01-login-${MODE}-${userTag}.png`, fullPage: true });

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

          await screenshot(page,{ path: `02-missing-${label}-${MODE}-${userTag}.png`, fullPage: true });
          throw new Error(`Cannot find visible ${label} with selector: ${selector}`);
        }

        await fillSmart(USERNAME_SELECTOR, username, "username");
        await fillSmart(PASSWORD_SELECTOR, password, "password");

        await Promise.all([page.waitForLoadState("networkidle"), page.click(SUBMIT_SELECTOR)]);
        await screenshot(page,{ path: `03-after-login-${MODE}-${userTag}.png`, fullPage: true });

        await page.goto(TARGET_URL, { waitUntil: "networkidle" });
        await screenshot(page,{ path: `04-target-${MODE}-${userTag}.png`, fullPage: true });

        // Resolve visibility/actionability before committing to a potentially non-idempotent click.
        await page.locator(buttonSelector).click({ trial: true });
        const verify = await prepareVerification(page,verificationConfig);
        const verification = await verify(async()=>{
          phase="click_started";progress(phase);
          await page.click(buttonSelector);
          phase="clicked";progress(phase);
        });
        phase=verification.verified?"verified":"clicked";
        progress(phase,{verification,reason:verification.reason});
        await screenshot(page,{ path: `05-after-click-${MODE}-${userTag}.png`, fullPage: true }).catch(()=>{});
        log(`${userTag}: ${MODE} ${phase}`);
        results.push({user:userTag,ok:true,verified:verification.verified,verification});
      } catch (e) {
        const safeError=String(e).split(password).join("[REDACTED]");
        progress(phase,{reason:safeError});
        logError(`❌ ${userTag}:`, safeError);

        if(diagnostics){
          const html = await page.content().catch(() => "");
          fs.writeFileSync(`debug-${MODE}-${userTag}.html`, html || "");
        }
        await screenshot(page,{ path: `error-${MODE}-${userTag}.png`, fullPage: true }).catch(()=>{});

        results.push({ user: userTag, ok: false, error: safeError });
      } finally {
        await context.close();
      }

      // ✅ Random delay between users
      if (
        idx < targets.length - 1 &&
        delayCfg.betweenMax > 0 &&
        delayCfg.betweenMax >= delayCfg.betweenMin
      ) {
        const s = randInt(delayCfg.betweenMin, delayCfg.betweenMax);
        log(`Between-users delay: ${s}s`);
        await sleep(s * 1000);
      }
    }

    if(diagnostics)fs.writeFileSync("results.json", JSON.stringify(results, null, 2), "utf-8");
    if (results.some(result => !result.ok)) process.exitCode = 1;
    log("Saved results.json");
  } finally {
    await browser.close();
  }
})().catch(error=>{logError("Runner failed:",error.message);process.exitCode=1;});
