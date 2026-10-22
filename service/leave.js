const fs=require("fs"),path=require("path"),crypto=require("crypto");
const {validDate,revision}=require("./configuration");
const {localTime}=require("./schedule");
const addDays=(date,days)=>new Date(Date.parse(date+"T00:00:00Z")+days*86400000).toISOString().slice(0,10);
function datesBetween(from,to){
 if(!validDate(from)||!validDate(to)||from>to)throw new Error("Chọn khoảng ngày hợp lệ: ngày kết thúc phải từ ngày bắt đầu trở đi.");
 const count=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 if(count>366)throw new Error("Mỗi đăng ký tối đa 366 ngày.");
 return Array.from({length:count},(_,i)=>addDays(from,i));
}
function legacyEntries(off){
 const entries=[];
 function ranges(dates,scope,usernames){
  const sorted=[...new Set(dates || [])].sort();let from,to;
  function push(){
   if(!from)return;
   const id="legacy-"+crypto.createHash("sha256").update(JSON.stringify([scope,usernames,from,to])).digest("hex").slice(0,24);
   entries.push({id,scope,usernames,from,to,note:"",legacy:true});
  }
  for(const date of sorted){
   if(!validDate(date))throw new Error("Ngày nghỉ cũ không hợp lệ; kiểm tra file trước khi sửa.");
   if(from && date===addDays(to,1) && (Date.parse(date)-Date.parse(from))/86400000<366)to=date;
   else{push();from=to=date;}
  }push();
 }
 ranges(off.global,"all",[]);
 for(const [name,dates]of Object.entries(off.users || {}))ranges(dates,"users",[name]);
 return entries;
}
function entriesFor(off){return Array.isArray(off.registrations)?off.registrations:legacyEntries(off);}
function materialize(off,registrations){
 const global=new Set(),users=new Map();
 for(const entry of registrations){
  const dates=datesBetween(entry.from,entry.to);
  if(entry.scope==="all")for(const date of dates)global.add(date);
  else for(const name of entry.usernames){
   if(!users.has(name))users.set(name,new Set());
   for(const date of dates)users.get(name).add(date);
  }
 }
 return {...off,registrations,global:[...global].sort(),users:Object.fromEntries([...users].map(([name,dates])=>[name,[...dates].sort()]))};
}
function leaveSnapshot(root,config,accounts){
 const file=path.resolve(root,config.offDaysFile),off=JSON.parse(fs.readFileSync(file,"utf8"));
 return {revision:revision(file),today:localTime(new Date(),config.timezone).date,skipWeekends:off.skipWeekends!==false,
  accounts:accounts.map(a=>({username:a.username,enabled:a.enabled!==false})),registrations:entriesFor(off)};
}
function updateLeave(root,config,accounts,body){
 const file=path.resolve(root,config.offDaysFile),off=JSON.parse(fs.readFileSync(file,"utf8"));
 let entries=entriesFor(off);
 if(body.action==="create" && entries.some(e=>e.id===body.entry?.id))return {saved:true,duplicate:true};
 if(body.revision!==revision(file)){const error=new Error("Ngày nghỉ đã thay đổi ở nơi khác. Tải lại trước khi lưu.");error.status=409;throw error;}
 if(body.action==="weekends"){
  if(typeof body.skipWeekends!=="boolean")throw new Error("Invalid weekend setting");
  off.skipWeekends=body.skipWeekends;
 }else if(body.action==="delete"){
  if(!entries.some(e=>e.id===body.id))throw new Error("Không tìm thấy đăng ký nghỉ.");
  entries=entries.filter(e=>e.id!==body.id);
 }else if(["create","update"].includes(body.action)){
  const entry=body.entry;
  if(!entry || typeof entry.id!=="string" || !/^[a-zA-Z0-9-]{10,100}$/.test(entry.id))throw new Error("Invalid registration ID");
  datesBetween(entry.from,entry.to);
  if(!["all","users"].includes(entry.scope))throw new Error("Chọn đối tượng nghỉ.");
  const allowed=new Set([...accounts.map(a=>a.username),...entries.flatMap(e=>e.usernames || [])]);
  const usernames=entry.scope==="all"?[]:[...new Set(entry.usernames || [])];
  if(entry.scope==="users" && (!usernames.length || usernames.some(name=>!allowed.has(name))))throw new Error("Chọn ít nhất một tài khoản hợp lệ.");
  if(typeof entry.note!=="string" || entry.note.length>300)throw new Error("Ghi chú tối đa 300 ký tự.");
  const next={id:entry.id,scope:entry.scope,usernames,from:entry.from,to:entry.to,note:entry.note,updatedAt:new Date().toISOString()};
  if(body.action==="update"){
   if(!entries.some(e=>e.id===entry.id))throw new Error("Không tìm thấy đăng ký nghỉ.");
   entries=entries.map(e=>e.id===entry.id?next:e);
  }else entries.push(next);
 }else throw new Error("Invalid leave action");
 const next=materialize(off,entries);
 fs.writeFileSync(file+".tmp",JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(file+".tmp",file);
 return {saved:true};
}
module.exports={addDays,datesBetween,legacyEntries,entriesFor,materialize,leaveSnapshot,updateLeave};
