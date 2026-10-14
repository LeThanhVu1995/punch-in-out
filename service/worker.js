
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {plan} = require("./schedule");
const codeRoot = path.resolve(__dirname, "..");
const root = process.env.PUNCH_ROOT ? path.resolve(process.env.PUNCH_ROOT) : codeRoot;
const configPath = path.resolve(root, process.env.PUNCH_CONFIG || "config.json");
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, {recursive:true});
const lock = path.join(dataDir, "worker.lock");
try {
  const fd = fs.openSync(lock, "wx");
  fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const pid = Number(fs.readFileSync(lock,"utf8"));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid worker.lock; inspect before deleting");
  try { process.kill(pid, 0); throw new Error("Another worker is running"); }
  catch (e) { if (e.code !== "ESRCH") throw e; }
  fs.unlinkSync(lock);
  const fd = fs.openSync(lock, "wx");
  fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
}
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const stateFile = path.join(dataDir, "state.json");
const state = fs.existsSync(stateFile) ? read(stateFile) : {};
function save() {
  fs.writeFileSync(stateFile + ".tmp", JSON.stringify(state,null,2));
  fs.renameSync(stateFile + ".tmp", stateFile);
}
let stopping = false, active;
for (const job of Object.values(state)) if (job.status === "running") job.status = "unknown";
save();
function stop() { stopping = true; if (active) active.kill(); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
function runJob(job, config) {
  return new Promise(resolve => {
    const folder = path.join(dataDir,"runs",job.date,
      Buffer.from(job.username).toString("hex") + "-" + job.mode);
    fs.mkdirSync(folder,{recursive:true});
    const output = fs.openSync(path.join(folder,"run.log"), "a");
    const emptyOff = path.join(folder,"off.json");
    fs.writeFileSync(emptyOff, JSON.stringify({timezone:config.timezone,skipWeekends:false}));
    active = spawn(process.execPath, [path.join(codeRoot,"run.js")], {
      cwd:folder, env:{...process.env,...Object.fromEntries(Object.entries(config.environment || {}).filter(([,v])=>v)),
        MODE:job.mode, ACCOUNT_USERNAME:job.username,
        ACCOUNTS_FILE:path.resolve(root,config.accountsFile), OFF_DAYS_FILE:emptyOff},
      stdio:["ignore",output,output]
    });
    let timedOut = false;
    const timer = setTimeout(() => {timedOut=true; active?.kill();},config.jobTimeoutSeconds*1000);
    active.once("error", error => console.error("Child process failed:",error.message));
    active.once("close", code => {
      clearTimeout(timer); fs.closeSync(output); active=undefined;
      // A click is not proof of server acceptance. Never automatically retry an ambiguous attempt.
      resolve(code === 0 && !timedOut && !stopping ? "clicked" : "unknown");
    });
  });
}
(async () => {
  try {
    console.log("Punch service started. VPN is managed externally.");
    while (!stopping) {
      const config = read(configPath);
      for (const key of ["LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR",
        "SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"])
        if (!(config.environment?.[key] || process.env[key])) throw new Error("Missing config environment: "+key);
      if (!Number.isFinite(config.pollSeconds) || config.pollSeconds < 1 ||
          !Number.isFinite(config.jobTimeoutSeconds) || config.jobTimeoutSeconds < 1)
        throw new Error("pollSeconds and jobTimeoutSeconds must be positive");
      const accounts = read(path.resolve(root,config.accountsFile));
      if (!Array.isArray(accounts) || !accounts.length ||
          new Set(accounts.map(a=>a.username)).size !== accounts.length) throw new Error("Invalid or duplicate accounts");
      const off = read(path.resolve(root,config.offDaysFile));
      const {jobs} = plan(config,off,accounts,state);
      save();
      for (const {job} of jobs) {
        if (stopping) break;
        // Recheck the window and calendar after waiting for another account.
        const eligible = plan(config,off,accounts,state).jobs.some(item=>item.job===job);
        if (!eligible) {save();continue;}
        job.status="running"; job.startedAt=new Date().toISOString(); save();
        job.status=await runJob(job,config);
        job.finishedAt=new Date().toISOString(); save();
        console.log(job.date,job.mode,job.username,job.status);
      }
      await new Promise(resolve=>setTimeout(resolve,config.pollSeconds*1000));
    }
  } finally { fs.unlinkSync(lock); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
