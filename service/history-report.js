const {readHistory}=require("./history"),{validDate}=require("./configuration");
function historyReport(root,state,from,to,username){
 if(!validDate(from)||!validDate(to)||from>to || (Date.parse(to)-Date.parse(from))/86400000>30)throw new Error("Chọn khoảng lịch sử tối đa 31 ngày.");
 const records=readHistory(root,state,undefined,Infinity).filter(r=>r.date>=from && r.date<=to && (!username || r.username===username));
 const groups=new Map();
 function group(date,name){
  const key=JSON.stringify([date,name]);
  if(!groups.has(key))groups.set(key,{date,username:name,IN:null,OUT:null,recordsCount:0});
  return groups.get(key);
 }
 for(const row of records){
  const item=group(row.date,row.username);item.recordsCount++;
  if(!item[row.mode])item[row.mode]={status:row.status,startedAt:row.startedAt,finishedAt:row.finishedAt,attempts:row.attempt,
   due:null,lastError:row.reason,verification:row.verification,legacy:row.legacy};
 }
 for(const job of Object.values(state)){
  if(job.date<from || job.date>to || (username && job.username!==username))continue;
  group(job.date,job.username)[job.mode]={status:job.status,due:job.due??null,startedAt:job.startedAt,finishedAt:job.finishedAt,
   attempts:job.attempts || 0,lastError:job.lastError,nextRetryAt:job.nextRetryAt,verification:job.verification};
 }
 const rows=[...groups.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.username.localeCompare(b.username));
 return {from,to,groups:rows,rows:records};
}
module.exports={historyReport};
