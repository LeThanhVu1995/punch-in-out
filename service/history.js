const fs=require("fs"),path=require("path");
function record(root,job,progress){
 const file=path.join(root,"data","history.jsonl");
 const row={id:[job.date,job.username,job.mode,job.attempts].join("|"),date:job.date,username:job.username,mode:job.mode,
  attempt:job.attempts,attemptInCycle:job.attemptsInCycle,status:job.status,
  startedAt:job.startedAt,finishedAt:job.finishedAt,nextRetryAt:job.nextRetryAt,
  progressFile:job.progressFile,manual:!!job.manualRequestedAt,
  phase:progress.phase,reason:progress.reason,verification:progress.verification,connection:job.connection};
 fs.appendFileSync(file,JSON.stringify(row)+"\n",{mode:0o600});
}
function readHistory(root,state,date,limit=2000){
 const file=path.join(root,"data","history.jsonl"),rows=[];
 if(fs.existsSync(file)){
  const fd=fs.openSync(file,"r");
  let text;
  try{
   const size=fs.fstatSync(fd).size,start=Math.max(0,size-20*1024*1024),buffer=Buffer.alloc(size-start);
   fs.readSync(fd,buffer,0,buffer.length,start);text=buffer.toString("utf8");
   if(start>0)text=text.slice(text.indexOf("\n")+1);
  }finally{fs.closeSync(fd);}
  for(const line of text.split("\n")){
   if(!line)continue;
   try{const row=JSON.parse(line);if(!date || row.date===date)rows.push(row);}catch{}
  }
 }
 const ids=new Set(rows.map(r=>r.id));
 for(const job of Object.values(state)){
  if((!date || job.date===date) && job.startedAt){
   const id=[job.date,job.username,job.mode,job.attempts].join("|");
   if(!ids.has(id))rows.push({id,date:job.date,username:job.username,mode:job.mode,status:job.status,
    attempt:job.attempts,startedAt:job.startedAt,finishedAt:job.finishedAt,progressFile:job.progressFile,legacy:true});
  }
 }
 return rows.sort((a,b)=>(b.startedAt || "").localeCompare(a.startedAt || "")).slice(0,limit);
}
module.exports={record,readHistory};
