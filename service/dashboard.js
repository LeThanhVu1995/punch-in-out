const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const {localTime}=require("./schedule"),{enqueue}=require("./manual");
const {leaveSnapshot,updateLeave}=require("./leave");
const {historyReport}=require("./history-report");
const {readHistory}=require("./history"),{checkConnectivity}=require("./connectivity");
const {validDate,editorSnapshot,updateConfig,updateHolidays,updateAccounts}=require("./configuration");
function startDashboard({root,configPath=path.join(root,"config.json"),state,save,settings,stopping,wake}) {
 const initial=settings().config;
 if(initial.dashboard?.enabled===false)return Promise.resolve(null);
 const port=initial.dashboard?.port ?? 17840;
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid dashboard port");
 const token=crypto.randomBytes(32).toString("hex"),hosts=new Set(["127.0.0.1:"+port,"localhost:"+port]);
 const startedAt=new Date().toISOString();let connection=null;
 const assets={"/":"dashboard.html","/dashboard.js":"dashboard-client.js"};
 function redact(value,accounts){
  if(typeof value==="string"){for(const a of accounts)if(a.password)value=value.split(a.password).join("[REDACTED]");return value;}
  if(Array.isArray(value))return value.map(v=>redact(v,accounts));
  if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,accounts)]));
  return value;
 }
 function dateFor(url,config){
  const value=url.searchParams.get("date") || localTime(new Date(),config.timezone).date;
  if(!validDate(value))throw new Error("Invalid date");return value;
 }
 function snapshot(url){
  const {config,accounts,allAccounts=accounts}=settings(),local=localTime(new Date(),config.timezone),date=dateFor(url,config);
  const names=new Set(allAccounts.map(a=>a.username));
  if(date!==local.date)for(const job of Object.values(state))if(job.date===date)names.add(job.username);
  const jobs=[];
  for(const username of names)for(const mode of ["IN","OUT"]){
   const job=state[JSON.stringify([date,username,mode])],account=allAccounts.find(a=>a.username===username);
   jobs.push({username,mode,date,due:job?.due ?? null,status:job?.status || "not_scheduled",
    enabled:account?.enabled!==false,attempts:job?.attempts || 0,attemptsInCycle:job?.attemptsInCycle ?? job?.attempts ?? 0,
    nextRetryAt:job?.nextRetryAt,startedAt:job?.startedAt,finishedAt:job?.finishedAt,lastExitCode:job?.lastExitCode,
    timedOut:job?.timedOut,manualRequestedAt:job?.manualRequestedAt,lastError:job?.lastError,verification:job?.verification,connection:job?.connection});
  }
  const connections=Object.values(state).map(j=>j.connection).filter(Boolean);
  if(connection)connections.push(connection);
  const latest=connections.sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0];
  return redact({token,startedAt,serverTime:new Date().toISOString(),timezone:config.timezone,date,today:local.date,
   recommendedMode:local.seconds<43200?"IN":"OUT",running:!stopping(),maxRetries:config.maxRetries??3,
   retryDelaySeconds:config.retryDelaySeconds??60,verificationMode:config.verification?.mode || "none",
   connectivity:latest,credentialsProtected:allAccounts.every(a=>!!a.passwordProtected),jobs},allAccounts);
 }
 function send(res,status,value,type="application/json"){
  res.writeHead(status,{"Content-Type":type+"; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
   "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
  res.end(type==="application/json"?JSON.stringify(value):value);
 }
 const server=http.createServer(async(req,res)=>{
  try{
   if(!hosts.has(req.headers.host))return send(res,403,{error:"Invalid host"});
   const url=new URL(req.url,"http://"+req.headers.host);
   if(req.method==="GET" && assets[url.pathname])return send(res,200,fs.readFileSync(path.join(__dirname,assets[url.pathname]),"utf8"),url.pathname.endsWith(".js")?"text/javascript":"text/html");
   if(req.method==="GET" && url.pathname==="/api/status")return send(res,200,snapshot(url));
   if(req.method==="GET" && url.pathname==="/api/leave"){const {config,accounts,allAccounts=accounts}=settings();return send(res,200,leaveSnapshot(root,config,allAccounts));}
   if(req.method==="GET" && url.pathname==="/api/editor")return send(res,200,editorSnapshot(root,configPath));
   if(req.method==="GET" && url.pathname==="/api/history"){
    const {config,accounts,allAccounts=accounts}=settings(),date=dateFor(url,config);
    const from=url.searchParams.get("from") || date,to=url.searchParams.get("to") || from;
    return send(res,200,{date,...redact(historyReport(root,state,from,to,url.searchParams.get("username")),allAccounts)});
   }
   if(req.method==="GET" && url.pathname==="/api/log"){
    const {config,accounts,allAccounts=accounts}=settings(),date=dateFor(url,config);
    let record;
    if(url.searchParams.has("eventId"))record=readHistory(root,state,date).find(r=>r.id===url.searchParams.get("eventId"));
    else{
     const username=url.searchParams.get("username"),mode=url.searchParams.get("mode");
     if(!["IN","OUT"].includes(mode) || (!allAccounts.some(a=>a.username===username) && !state[JSON.stringify([date,username,mode])]))return send(res,400,{error:"Invalid account or mode"});
     record=state[JSON.stringify([date,username,mode])];
    }
    if(!record?.progressFile)return send(res,200,{text:record?.reason || record?.lastError || "No browser log yet; review connectivity or attempt history."});
    const file=path.resolve(root,path.dirname(record.progressFile),"run.log"),base=path.join(root,"data","runs")+path.sep;
    if(!file.startsWith(base))return send(res,400,{error:"Invalid log path"});
    if(!fs.existsSync(file))return send(res,200,{text:"No attempt log yet."});
    const fd=fs.openSync(file,"r");let data;
    try{const size=fs.fstatSync(fd).size;data=Buffer.alloc(Math.min(size,32768));fs.readSync(fd,data,0,data.length,Math.max(0,size-data.length));}
    finally{fs.closeSync(fd);}
    return send(res,200,{text:redact(data.toString("utf8"),allAccounts)});
   }
   if(req.method==="POST"){
    if(stopping())return send(res,503,{error:"Service is stopping"});
    if(req.headers.origin!=="http://"+req.headers.host || req.headers["x-punch-token"]!==token)return send(res,403,{error:"Reload local dashboard before submitting"});
    if(!req.headers["content-type"]?.startsWith("application/json"))return send(res,415,{error:"JSON required"});
    let raw="";for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>262144)return send(res,413,{error:"Request too large"});}
    let body;try{body=JSON.parse(raw);}catch{return send(res,400,{error:"Invalid JSON"});}
    const {config,accounts}=settings();
    if(url.pathname==="/api/run"){
     const result=enqueue(config,accounts,state,body);save();
     fs.appendFileSync(path.join(root,"data","manual-actions.jsonl"),JSON.stringify({at:new Date().toISOString(),requestId:body.requestId,scope:body.scope,username:body.scope==="user"?body.username:undefined,confirmRepeat:body.confirmRepeat===true,...result})+"\n");
     wake();return send(res,200,result);
    }
    if(url.pathname==="/api/check"){connection=await checkConnectivity(config);return send(res,200,connection);}
    if(url.pathname==="/api/config"){const result=updateConfig(root,configPath,body);wake();return send(res,200,{...result,note:"Existing daily random times are preserved; new windows apply immediately as limits and to future schedules."});}
    if(url.pathname==="/api/leave"){const {allAccounts=accounts}=settings();const result=updateLeave(root,config,allAccounts,body);wake();return send(res,200,result);}
    if(url.pathname==="/api/holidays"){const result=updateHolidays(root,configPath,body);wake();return send(res,200,result);}
    if(url.pathname==="/api/accounts"){const result=updateAccounts(root,configPath,body);wake();return send(res,200,result);}
   }
   send(res,404,{error:"Not found"});
  }catch(error){send(res,error.status || 400,{error:error.message});}
 });
 server.requestTimeout=15000;
 return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",()=>{console.log("Dashboard: http://127.0.0.1:"+port);resolve(server);});});
}
module.exports={startDashboard};
