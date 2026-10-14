
const crypto = require("crypto");
function clock(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("Invalid time: " + value);
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error("Invalid time: " + value);
  return h * 3600 + m * 60;
}
function localTime(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map(p => [p.type, p.value]));
  const date = parts.year + "-" + parts.month + "-" + parts.day;
  return {date, weekday: new Date(date + "T12:00:00Z").getUTCDay(),
    seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second};
}
function plan(config, off, accounts, state, now = new Date()) {
  const local = localTime(now, config.timezone);
  if (!Array.isArray(config.weekdays) || !config.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6))
    throw new Error("weekdays must contain numbers 0..6");
  for (const mode of ["IN", "OUT"]) {
    const window = config.windows[mode];
    if (clock(window.from) > clock(window.to)) throw new Error("Window must end after it starts");
  }
  if (!config.weekdays.includes(local.weekday) ||
      (off.skipWeekends !== false && [0,6].includes(local.weekday)) ||
      (off.global || []).includes(local.date)) return {local, jobs: []};
  const jobs = [];
  for (const acc of accounts) {
    if (!acc.username || !acc.password) throw new Error("Account requires username and password");
    const tag = String(acc.username).replace(/[^a-zA-Z0-9._-]/g, "_");
    if ((off.users?.[acc.username] || off.users?.[tag] || []).includes(local.date)) continue;
    for (const mode of ["IN", "OUT"]) {
      const window = config.windows[mode];
      const from = clock(window.from), to = clock(window.to);
      const key = JSON.stringify([local.date, acc.username, mode]);
      if (!state[key]) state[key] = { date: local.date, username: acc.username, mode,
        due: crypto.randomInt(from, to + 1), status: "pending" };
      const job = state[key];
      if (job.status !== "pending") continue;
      if (local.seconds > to) { job.status = "missed"; continue; }
      if (local.seconds >= job.due) jobs.push({key, job});
    }
  }
  return {local, jobs: jobs.sort((a,b) => a.job.due - b.job.due)};
}
module.exports = {clock, localTime, plan};
