const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {localTime}=require("./schedule");
const {enqueue}=require("./manual");
function startDashboard({root,state,save,settings,stopping,wake}) {
  const initial=settings().config;
  if(initial.dashboard?.enabled===false)return Promise.resolve(null);
  const port=initial.dashboard?.port ?? 17840;
  if(!Number.isInteger(port) || port<1 || port>65535)throw new Error("Invalid dashboard port");
  const token=crypto.randomBytes(32).toString("hex");
  const allowedHosts=new Set(["127.0.0.1:"+port,"localhost:"+port]);
  const assets={"/":"dashboard.html","/dashboard.js":"dashboard-client.js"};
  const startedAt=new Date().toISOString();
  function redact(value,accounts) {
    let text=String(value || "");
    for(const a of accounts) if(a.password)text=text.split(a.password).join("[REDACTED]");
    return text;
  }
  function snapshot() {
    const {config,accounts}=settings();
    const local=localTime(new Date(),config.timezone);
    const jobs=[];
    for(const account of accounts)for(const mode of ["IN","OUT"]) {
      const job=state[JSON.stringify([local.date,account.username,mode])];
      jobs.push({username:account.username,mode,date:local.date,due:job?.due ?? null,
        status:job?.status || "not_scheduled",attempts:job?.attempts || 0,
        attemptsInCycle:job?.attemptsInCycle ?? job?.attempts ?? 0,
        nextRetryAt:job?.nextRetryAt,startedAt:job?.startedAt,finishedAt:job?.finishedAt,
        lastExitCode:job?.lastExitCode,timedOut:job?.timedOut,
        manualRequestedAt:job?.manualRequestedAt});
    }
    return {token,startedAt,serverTime:new Date().toISOString(),timezone:config.timezone,date:local.date,
      recommendedMode:local.seconds<12*3600?"IN":"OUT",running:!stopping(),
      maxRetries:config.maxRetries ?? 3,retryDelaySeconds:config.retryDelaySeconds ?? 60,jobs};
  }
  function send(res,status,value,type="application/json") {
    res.writeHead(status,{"Content-Type":type+"; charset=utf-8","Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
      "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
    res.end(type==="application/json"?JSON.stringify(value):value);
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(!allowedHosts.has(req.headers.host))return send(res,403,{error:"Invalid host"});
      const url=new URL(req.url,"http://"+req.headers.host);
      if(req.method==="GET" && assets[url.pathname]) {
        return send(res,200,fs.readFileSync(path.join(__dirname,assets[url.pathname]),"utf8"),
          url.pathname.endsWith(".js")?"text/javascript":"text/html");
      }
      if(req.method==="GET" && url.pathname==="/api/status")return send(res,200,snapshot());
      if(req.method==="GET" && url.pathname==="/api/log") {
        const {config,accounts}=settings();
        const username=url.searchParams.get("username"),mode=url.searchParams.get("mode");
        const date=localTime(new Date(),config.timezone).date;
        if(!accounts.some(a=>a.username===username) || !["IN","OUT"].includes(mode))
          return send(res,400,{error:"Invalid account or mode"});
        const job=state[JSON.stringify([date,username,mode])];
        if(!job?.progressFile)return send(res,200,{text:"No attempt log yet."});
        const file=path.resolve(root,path.dirname(job.progressFile),"run.log");
        const base=path.join(root,"data","runs")+path.sep;
        if(!file.startsWith(base))return send(res,400,{error:"Invalid log path"});
        if(!fs.existsSync(file))return send(res,200,{text:"No attempt log yet."});
        const fd=fs.openSync(file,"r");
        let data;
        try {const size=fs.fstatSync(fd).size;data=Buffer.alloc(Math.min(size,32768));fs.readSync(fd,data,0,data.length,Math.max(0,size-data.length));}
        finally {fs.closeSync(fd);}
        return send(res,200,{text:redact(data.toString("utf8"),accounts)});
      }
      if(req.method==="POST" && url.pathname==="/api/run") {
        if(stopping())return send(res,503,{error:"Service is stopping"});
        if(req.headers.origin!=="http://"+req.headers.host || req.headers["x-punch-token"]!==token)
          return send(res,403,{error:"Reload the local dashboard before submitting"});
        if(!req.headers["content-type"]?.startsWith("application/json"))
          return send(res,415,{error:"JSON required"});
        let raw="";
        for await(const chunk of req) {raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(res,413,{error:"Request too large"});}
        let request;
        try {request=JSON.parse(raw);}catch{return send(res,400,{error:"Invalid JSON"});}
        const {config,accounts}=settings();
        const result=enqueue(config,accounts,state,request);
        save();
        fs.appendFileSync(path.join(root,"data","manual-actions.jsonl"),JSON.stringify({
          at:new Date().toISOString(),requestId:request.requestId,scope:request.scope,
          username:request.scope==="user"?request.username:undefined,confirmRepeat:request.confirmRepeat===true,...result})+"\n");
        wake();
        return send(res,200,result);
      }
      send(res,404,{error:"Not found"});
    }catch(error){send(res,error.status || 400,{error:error.message});}
  });
  server.requestTimeout=10000;
  return new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(port,"127.0.0.1",()=>{console.log("Dashboard: http://127.0.0.1:"+port);resolve(server);});
  });
}
module.exports={startDashboard};
