
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {dueJobs} = require("./manual");
const {startDashboard} = require("./dashboard");
const {retryConfig, readProgress, complete} = require("./retry");
const {loadAccounts}=require("./accounts");
const {checkConnectivity}=require("./connectivity");
const {record}=require("./history");
const {localTime}=require("./schedule");
const {readState,stateWriter,purgeDiagnostics}=require("./storage");
const {randomUUID}=require("crypto");
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
const state = readState(stateFile);
const writeState=stateWriter(stateFile);
function save(){writeState(state);}
let stopping = false, active, dashboard, wakeResolve, wakeRequested = false;
function wake() { wakeRequested = true; if(wakeResolve)wakeResolve(); }
async function pause(seconds) {
  if(wakeRequested){wakeRequested=false;return;}
  await new Promise(resolve=>{
    const timer=setTimeout(done,seconds*1000);
    function done(){clearTimeout(timer);wakeResolve=undefined;resolve();}
    wakeResolve=done;
  });
  wakeRequested=false;
}
// Legacy unknown jobs have no reliable click phase and remain untouched.
const initialConfig = read(configPath);
retryConfig(initialConfig);
for (const job of Object.values(state)) if (job.status === "running") {
  const progress = job.progressFile ? readProgress(path.resolve(root,job.progressFile)) : (job.phase?{phase:job.phase}:{});
  complete(job, progress, initialConfig);
  if(initialConfig.diagnostics?.enabled===true)record(root,job,progress);
}
save();
if(initialConfig.diagnostics?.enabled!==true)purgeDiagnostics(root);
function stop() { stopping = true; wake(); if (active) active.kill(); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
async function runJob(job, config) {
    const diagnostics=config.diagnostics?.enabled===true;
    const folder = diagnostics?path.join(dataDir,"runs",job.date,
      Buffer.from(job.username).toString("hex") + "-" + job.mode, "attempt-" + job.attempts)
      :path.join(dataDir,"runs",randomUUID());
    fs.mkdirSync(folder,{recursive:true});
    const progressFile = path.join(folder,"progress.json");
    job.progressFile = path.relative(root,progressFile);
    // Persist attempt and phase before launching; each attempt has its own evidence.
    fs.writeFileSync(progressFile, JSON.stringify({phase:"before_click"}));
    save();
  if(config.preflight?.enabled!==false){
    job.connection=await checkConnectivity(config);save();
    if(!job.connection.ok)return {phase:"before_click",reason:"Website unreachable: "+job.connection.results.filter(r=>!r.ok).map(r=>r.name+" "+r.error).join("; ")};
  }
  if(stopping)return {phase:"before_click",reason:"Service stopped before browser launch"};
  return new Promise(resolve => {
    const output = diagnostics?fs.openSync(path.join(folder,"run.log"), "a"):null;
    const emptyOff = path.join(folder,"off.json");
    fs.writeFileSync(emptyOff, JSON.stringify({timezone:config.timezone,skipWeekends:false}));
    active = spawn(process.execPath, [path.join(codeRoot,"run.js")], {
      cwd:folder, env:{...process.env,...Object.fromEntries(Object.entries(config.environment || {}).filter(([,v])=>v)),
        PUNCH_DIAGNOSTICS:diagnostics?"1":"0",
        MODE:job.mode, ACCOUNT_USERNAME:job.username, ATTEMPT_PROGRESS_FILE:progressFile,
        PUNCH_VERIFICATION:JSON.stringify(config.verification || {mode:"none"}),
        ACCOUNTS_FILE:path.resolve(root,config.accountsFile), OFF_DAYS_FILE:emptyOff},
      stdio:output===null?"ignore":["ignore",output,output]
    });
    let timedOut = false;
    const timer = setTimeout(() => {timedOut=true; active?.kill();},config.jobTimeoutSeconds*1000);
    active.once("error", () => {});
    active.once("close", code => {
      clearTimeout(timer); if(output!==null)fs.closeSync(output); active=undefined;
      job.lastExitCode = code;
      job.timedOut = timedOut;
      resolve(readProgress(progressFile));
    });
  });
}
function settings() {
  const config = read(configPath);
  for (const key of ["LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR",
    "SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"])
    if (!(config.environment?.[key] || process.env[key])) throw new Error("Missing config environment: "+key);
  if (!Number.isFinite(config.pollSeconds) || config.pollSeconds < 1 ||
      !Number.isFinite(config.jobTimeoutSeconds) || config.jobTimeoutSeconds < 1)
    throw new Error("pollSeconds and jobTimeoutSeconds must be positive");
  retryConfig(config);
  const allAccounts = loadAccounts(path.resolve(root,config.accountsFile));
  const accounts = allAccounts.filter(a=>a.enabled!==false);
  if (!Array.isArray(accounts) || !allAccounts.length ||
      new Set(accounts.map(a=>a.username)).size !== accounts.length) throw new Error("Invalid or duplicate accounts");
  const off = read(path.resolve(root,config.offDaysFile));
  return {config,accounts,allAccounts,off};
}

(async () => {
  try {
    
    dashboard=await startDashboard({root,configPath,state,save,settings,stopping:()=>stopping,wake});
    while (!stopping) {
      const {config,accounts,off} = settings();
      if(config.diagnostics?.enabled!==true){
        const today=localTime(new Date(),config.timezone).date;
        for(const [key,job] of Object.entries(state))if(job.date!==today && job.status!=="running")delete state[key];
      }
      const jobs = dueJobs(config,off,accounts,state);
      save();
      for (const {job} of jobs) {
        if (stopping) break;
        // Recheck the window and calendar after waiting for another account.
        const eligible = dueJobs(config,off,accounts,state).some(item=>item.job===job);
        if (!eligible) {save();continue;}
        job.attemptsInCycle = (job.attemptsInCycle ?? job.attempts ?? 0) + 1;
        job.attempts = (job.attempts || 0) + 1;
        for(const field of ["progressFile","connection","verification","finishedAt","lastError"])delete job[field];
        job.phase="before_click";
        job.status="running"; job.startedAt=new Date().toISOString(); save();
        const progress = await runJob(job,config);
        complete(job,progress,config);
        if(config.diagnostics?.enabled!==true && job.progressFile){
          fs.rmSync(path.dirname(path.resolve(root,job.progressFile)),{recursive:true,force:true});
          delete job.progressFile;
        }
        save();
        if(config.diagnostics?.enabled===true)record(root,job,progress);
      }
      await pause(config.pollSeconds);
    }
  } finally {
    if(dashboard){dashboard.closeAllConnections();await new Promise(resolve=>dashboard.close(resolve));}
    fs.unlinkSync(lock);
  }
})().catch(error=>{console.error("Service stopped because of an internal error.");process.exitCode=1;});
