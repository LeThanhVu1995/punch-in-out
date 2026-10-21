const {localTime} = require("./schedule");
function dueJobs(config, off, accounts, state, now = new Date()) {
  const {plan} = require("./schedule");
  const scheduled = plan(config,off,accounts,state,now).jobs;
  const {date} = localTime(now,config.timezone);
  const current = new Set(accounts.map(a=>a.username));
  const manual=[];
  for(const [key,job] of Object.entries(state)) {
    if (!job.manualRequestedAt || job.status!=="pending") continue;
    if(job.date!==date){job.status="missed";continue;}
    if(!current.has(job.username))continue;
    if(job.nextRetryAt && now.getTime()<Date.parse(job.nextRetryAt))continue;
    manual.push({key,job});
  }
  return [...manual.sort((a,b)=>a.job.manualRequestedAt.localeCompare(b.job.manualRequestedAt)),...scheduled];
}
function enqueue(config, accounts, state, request, now = new Date()) {
  if(!["IN","OUT"].includes(request.mode)) throw new Error("Select IN or OUT");
  if(!["all","failed","user"].includes(request.scope)) throw new Error("Invalid scope");
  if(typeof request.requestId!=="string" || !/^[a-zA-Z0-9-]{16,80}$/.test(request.requestId)) throw new Error("Invalid request ID");
  const date=localTime(now,config.timezone).date;
  const targets=accounts.filter(a=>request.scope!=="user" || a.username===request.username);
  if(!targets.length) throw new Error("Account not found");
  const selected=targets.map(a=>{
    const key=JSON.stringify([date,a.username,request.mode]);
    return {key,username:a.username,job:state[key]};
  }).filter(({job})=>request.scope!=="failed" || ["failed","unknown","missed"].includes(job?.status));
  const risky=selected.filter(({job})=>["clicked","unknown"].includes(job?.status) &&
    !job.manualRequests?.includes(request.requestId));
  if(risky.length && request.confirmRepeat!==true) {
    const error=new Error("Some accounts already clicked or have unknown results. Check attendance and explicitly confirm repeating.");
    error.status=409;throw error;
  }
  let queued=0,skipped=0;
  for(const {key,username,job:previous} of selected) {
    if(previous?.status==="running" || previous?.manualRequests?.includes(request.requestId)) {skipped++;continue;}
    const job=previous || {date,username,mode:request.mode,due:0,attempts:0};
    job.manualRequests=[...(job.manualRequests || []),request.requestId];
    job.manualRequestedAt=now.toISOString();
    job.attemptsInCycle=0;
    job.status="pending";
    delete job.nextRetryAt;
    delete job.progressFile;
    delete job.lastExitCode;
    delete job.timedOut;
    state[key]=job;queued++;
  }
  return {queued,skipped,date,mode:request.mode};
}
module.exports={dueJobs,enqueue};
