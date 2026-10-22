let snapshot,initialized=false,busy=false,view="monitor",editor;
let leaveData,leaveMonth,selectedLeaveDay=null,leaveLimit=20,editingLeaveId,historyData,historyLoading=0,historyRange;
const dayPlus=(date,n)=>new Date(Date.parse(date+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
const prettyDate=date=>new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
const editable={};
const $=id=>document.getElementById(id);
const labels={pending:"Đang chờ",running:"Đang chạy",success:"Đã xác minh",clicked:"Đã bấm · chưa xác minh",failed:"Thất bại",unknown:"Chưa rõ kết quả",missed:"Quá giờ",not_scheduled:"Không có lịch"};
const time=value=>value?new Intl.DateTimeFormat("vi-VN",{timeZone:snapshot.timezone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date(value)):"—";
const due=value=>value===null?"—":[Math.floor(value/3600),Math.floor(value%3600/60),value%60].map(n=>String(n).padStart(2,"0")).join(":");
function cell(row,text){const td=document.createElement("td");td.textContent=text;row.append(td);return td;}
function render(){
 if(!snapshot)return;
 const mode=$("mode").value,search=$("search").value.toLowerCase(),filter=$("filter").value;
 const jobs=snapshot.jobs.filter(j=>j.mode===mode);
 $("subtitle").textContent=snapshot.date+" · "+snapshot.timezone+" · Dashboard trên máy này";
 $("users").textContent=jobs.length;
 $("clicked").textContent=jobs.filter(j=>j.status==="success").length+" / "+jobs.filter(j=>j.status==="clicked").length;
 $("errors").textContent=jobs.filter(j=>["failed","unknown","missed"].includes(j.status)).length;
 $("waiting").textContent=jobs.filter(j=>["pending","running"].includes(j.status)).length;
 $("policy").textContent="Tự cập nhật 3 giây · Tối đa "+snapshot.maxRetries+" lần thử lại · Cách nhau "+snapshot.retryDelaySeconds+" giây";
 $("rows").replaceChildren();
 for(const job of jobs.filter(j=>j.username.toLowerCase().includes(search) &&
   (filter==="all" || (filter==="errors"?["failed","unknown","missed"].includes(j.status):(filter==="clicked"?["success","clicked"].includes(j.status):j.status===filter)))).sort((a,b)=>(a.due ?? 999999)-(b.due ?? 999999))){
   const row=document.createElement("tr");
   cell(row,job.username+(job.enabled?"":" · đã tắt"));
   cell(row,job.manualRequestedAt?"Chạy ngay":due(job.due));
   const status=cell(row,""),badge=document.createElement("span");
   badge.className="badge "+job.status;badge.textContent=labels[job.status] || job.status;status.append(badge);
   if(job.lastError){const error=document.createElement("div");error.className="error-text";error.textContent=job.lastError;status.append(error);}
   if(job.nextRetryAt){const next=document.createElement("div");next.className="small";next.textContent="Thử lại "+time(job.nextRetryAt);status.append(next);}
   cell(row,job.attemptsInCycle+" / "+(snapshot.maxRetries+1)+" · tổng "+job.attempts);
   cell(row,time(job.startedAt)+" → "+time(job.finishedAt));
   const actions=cell(row,""),run=document.createElement("button"),log=document.createElement("button");
   run.textContent="Chạy ngay";run.disabled=busy || job.status==="running" || snapshot.date!==snapshot.today || !job.enabled;run.onclick=()=>execute("user",job.username);
   log.textContent="Log";log.style.marginLeft="6px";log.onclick=()=>showLog(job);
   actions.append(run,log);$("rows").append(row);
 }
 const historical=snapshot.date!==snapshot.today;
 $("activate").disabled=busy || historical;$("failed").disabled=busy || historical;
 $("health").textContent="Mật khẩu: "+(snapshot.credentialsProtected?"DPAPI":"còn dạng văn bản")+" · Xác minh: "+snapshot.verificationMode+" · Kết nối: "+
  (snapshot.connectivity?(snapshot.connectivity.ok?"website truy cập được":"lỗi truy cập")+" ("+time(snapshot.connectivity.checkedAt)+")":"chưa kiểm tra");
 if(!$("rows").children.length){const row=document.createElement("tr"),td=cell(row,"Không có tài khoản phù hợp");td.colSpan=6;$("rows").append(row);}
}
async function refresh(){
 try{
   const response=await fetch("/api/status"+($("date").value?"?date="+$("date").value:""),{cache:"no-store"});
   if(!response.ok)throw new Error("HTTP "+response.status);
   snapshot=await response.json();
   if(!initialized){$("mode").value=snapshot.recommendedMode;$("date").value=snapshot.date;initialized=true;}
   $("connection").textContent="● Service online";$("connection").style.background="#dff6ec";
   $("updated").textContent="Cập nhật "+time(snapshot.serverTime);render();if(view==="history")await loadHistory();
 }catch(error){$("connection").textContent="Service offline";$("connection").style.background="#feeae6";$("message").textContent="Không kết nối được service: "+error.message;}
}
async function execute(scope,username,options={}){
 if(busy || !snapshot)return;
 const mode=options.mode || $("mode").value,targetDate=options.date || snapshot.date;
 if(targetDate!==snapshot.today){tell("Chỉ chạy lại được lượt của hôm nay. Lịch sử cũ được giữ nguyên.");return;}
 busy=true;render();
 try{
  const current=await (await fetch("/api/status",{cache:"no-store"})).json();
  const targets=current.jobs.filter(j=>j.enabled!==false && j.mode===mode && (scope!=="user" || j.username===username) &&
   (scope!=="failed" || ["failed","unknown","missed"].includes(j.status)));
  if(!targets.length){tell("Không có lượt phù hợp để chạy.");return;}
  const risky=targets.some(j=>["success","clicked","unknown"].includes(j.status));
  if(!confirm("Chạy "+mode+" ngay cho "+(scope==="user"?username:targets.length+" tài khoản")+"? Bỏ qua giờ hẹn và ngày nghỉ hôm nay."+
   (risky?" Có lượt đã bấm hoặc chưa rõ kết quả. Chỉ tiếp tục sau khi kiểm tra chấm công để tránh bấm trùng.":"")))return;
  const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json","X-Punch-Token":current.token},
   body:JSON.stringify({requestId:crypto.randomUUID(),mode,scope,username,confirmRepeat:risky})});
  const result=await response.json();if(!response.ok)throw Error(result.error);
  tell("Đã xếp "+result.queued+" tài khoản chạy ngay; bỏ qua "+result.skipped+" lượt đang chạy hoặc yêu cầu trùng.");
  if($("attempts-dialog").open)$("attempts-dialog").close();
 }catch(error){tell(error);}
 finally{busy=false;await refresh();}
}
async function showLog(job){
 $("logtitle").textContent=job.username+" · "+job.mode+" · lượt thử gần nhất";$("logtext").textContent="Đang tải…";$("logs").showModal();
 try{
   const response=await fetch("/api/log?"+new URLSearchParams({username:job.username,mode:job.mode,date:snapshot.date}));
   const data=await response.json();$("logtext").textContent=data.text || data.error;
 }catch(error){$("logtext").textContent=error.message;}
}
$("mode").onchange=render;$("search").oninput=render;$("filter").onchange=render;
$("refresh").onclick=refresh;$("activate").onclick=()=>execute("all");$("failed").onclick=()=>execute("failed");
$("closeLogs").onclick=()=>$("logs").close();
refresh();setInterval(refresh,3000);

async function post(url,body){
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","X-Punch-Token":snapshot.token},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
function tell(error){$("message").textContent=error.message || error;}
async function selectView(next){
 view=next;
 for(const name of ["monitor","leave","history","settings"]){$(name).hidden=name!==view;$("tab-"+name).classList.toggle("active",name===view);}
 $("monitor-cards").hidden=view!=="monitor";$("monitor-notice").hidden=view!=="monitor";
 if(view==="leave")await loadLeave();
 if(view==="history"){if(!$("history-from").value){$("history-from").value=snapshot.today;$("history-to").value=snapshot.today;}await loadHistory();}
 if(view==="settings" && !editor)await loadEditor();
}
function field(id,label,value,type="text"){
 const wrapper=document.createElement("label");wrapper.className="field";wrapper.textContent=label;
 const input=document.createElement("input");input.id="edit-"+id;input.type=type;
 if(type==="checkbox")input.checked=!!value;else input.value=value ?? "";
 wrapper.append(input);$("configfields").append(wrapper);editable[id]=input;return input;
}
function dropdown(id,label,value,options){
 const wrapper=document.createElement("label");wrapper.className="field";wrapper.textContent=label;
 const input=document.createElement("select");
 for(const [v,text] of options){const option=document.createElement("option");option.value=v;option.textContent=text;input.append(option);}
 input.value=value;wrapper.append(input);$("configfields").append(wrapper);editable[id]=input;return input;
}
async function loadEditor(){
 try{
  const response=await fetch("/api/editor");editor=await response.json();if(!response.ok)throw Error(editor.error);
  $("configfields").replaceChildren();const c=editor.config;
  field("timezone","Múi giờ",c.timezone);field("weekdays","Ngày chạy: 1=T2 … 6=T7, 0=CN",c.weekdays.join(","));
  for(const mode of ["IN","OUT"])for(const part of ["from","to"])field(mode+"-"+part,mode+" · "+(part==="from"?"từ":"đến"),c.windows[mode][part],"time");
  field("maxRetries","Số lần retry (0–3)",c.maxRetries,"number");field("retryDelaySeconds","Khoảng retry (giây)",c.retryDelaySeconds,"number");
  field("pollSeconds","Chu kỳ kiểm tra (giây)",c.pollSeconds,"number");field("jobTimeoutSeconds","Timeout mỗi lượt (giây)",c.jobTimeoutSeconds,"number");
  for(const [name,value] of Object.entries(c.environment))field(name,name,value);
  field("preflight-enabled","Kiểm tra kết nối trước mỗi lượt",c.preflight.enabled!==false,"checkbox");field("preflight-timeout","Timeout kết nối (ms)",c.preflight.timeoutMs,"number");
  dropdown("verify-mode","Cách xác minh",c.verification.mode,[["none","Chưa cấu hình"],["selector","Nội dung mới trên website"],["response","Phản hồi JSON từ website"]]);
  field("verify-timeout","Timeout xác minh (ms)",c.verification.timeoutMs??15000,"number");
  field("verify-selector","CSS selector thông báo thành công",c.verification.selector);
  field("verify-text","Nội dung thành công phải chứa",c.verification.expectedText);
  field("verify-url","URL phản hồi phải chứa",c.verification.urlIncludes);
  field("verify-method","HTTP method phản hồi (để trống = bất kỳ)",c.verification.method);
  field("verify-path","JSON path xác nhận, ví dụ data.success",c.verification.jsonPath);
  field("verify-equals","Giá trị JSON mong đợi, ví dụ true hoặc \"SUCCESS\"",JSON.stringify(c.verification.equals ?? true));
  $("settings-note").textContent="Cần selector/response chính xác của website. Không dùng HTTP 200 làm bằng chứng chấm công thành công. Thông báo cũ không được tính.";
  $("accountrows").replaceChildren();for(const account of editor.accounts)addAccount(account);
  $("protection-note").textContent=editor.protectionAvailable?"Mật khẩu mới được mã hóa bằng Windows DPAPI. Để trống để giữ mật khẩu cũ. Lưu sẽ bảo vệ cả tài khoản còn dạng văn bản.":"Chạy bản Windows EXE mới để mã hóa và chỉnh tài khoản. Mật khẩu không được trả về trình duyệt.";
  $("save-accounts").disabled=!editor.protectionAvailable;
 }catch(error){editor=undefined;tell(error);}
}
function addAccount(account={}){
 const row=document.createElement("tr"),user=document.createElement("input"),password=document.createElement("input"),enabled=document.createElement("input");
 user.value=account.username || "";user.placeholder="Username";user.dataset.role="username";user.readOnly=!!account.username;
 password.type="password";password.autocomplete="new-password";password.placeholder=account.username?"Giữ mật khẩu hiện tại":"Mật khẩu";password.dataset.role="password";
 enabled.type="checkbox";enabled.checked=account.enabled!==false;enabled.dataset.role="enabled";
 for(const input of [user,password,enabled])cell(row,"").append(input);
 cell(row,account.username?(account.protected?"DPAPI":"Chưa bảo vệ"):"Mới");
 const button=document.createElement("button");button.textContent="Xóa";button.onclick=()=>{if(confirm("Xóa tài khoản "+user.value+" khỏi lịch sắp tới?"))row.remove();};
 cell(row,"").append(button);$("accountrows").append(row);
}
$("save-config").onclick=async()=>{
 if(!editor)return;try{
  const value=id=>editable[id].value;
  const verification={mode:value("verify-mode"),timeoutMs:+value("verify-timeout")};
  if(verification.mode==="selector"){verification.selector=value("verify-selector");verification.expectedText=value("verify-text");}
  if(verification.mode==="response"){verification.urlIncludes=value("verify-url");verification.method=value("verify-method").toUpperCase();verification.jsonPath=value("verify-path");verification.equals=JSON.parse(value("verify-equals"));}
  const config={timezone:value("timezone"),weekdays:value("weekdays").split(",").map(n=>Number(n.trim())),
   windows:Object.fromEntries(["IN","OUT"].map(mode=>[mode,{from:value(mode+"-from"),to:value(mode+"-to")}])),
   maxRetries:+value("maxRetries"),retryDelaySeconds:+value("retryDelaySeconds"),pollSeconds:+value("pollSeconds"),jobTimeoutSeconds:+value("jobTimeoutSeconds"),
   environment:Object.fromEntries(Object.keys(editor.config.environment).map(name=>[name,value(name)])),verification,
   preflight:{enabled:editable["preflight-enabled"].checked,timeoutMs:+value("preflight-timeout")}};
  await post("/api/config",{revision:editor.configRevision,config});tell("Đã lưu cấu hình. Lịch giờ hôm nay đã tạo vẫn được giữ.");await loadEditor();await refresh();
 }catch(error){tell(error);}
};
$("save-accounts").onclick=async()=>{
 if(!editor)return;try{
  const accounts=[...$("accountrows").children].map(row=>({username:row.querySelector('[data-role="username"]').value,
   password:row.querySelector('[data-role="password"]').value,enabled:row.querySelector('[data-role="enabled"]').checked}));
  await post("/api/accounts",{revision:editor.accountsRevision,accounts});tell("Đã lưu tài khoản và bảo vệ mật khẩu bằng DPAPI.");await loadEditor();await refresh();
 }catch(error){tell(error);}
};
for(const name of ["monitor","leave","history","settings"])$("tab-"+name).onclick=()=>selectView(name);
$("load-editor").onclick=loadEditor;$("add-account").onclick=()=>addAccount();$("history-refresh").onclick=loadHistory;
$("date").onchange=refresh;$("today").onclick=()=>{$("date").value=snapshot.today;refresh();};
$("check-network").onclick=async()=>{try{$("check-network").disabled=true;const result=await post("/api/check",{});tell(result.ok?"Website truy cập được. Kiểm tra này không chấm công.":result.results.filter(r=>!r.ok).map(r=>r.name+": "+r.error).join("; "));await refresh();}catch(error){tell(error);}finally{$("check-network").disabled=false;}};

async function loadLeave(){
 try{
  const response=await fetch("/api/leave",{cache:"no-store"}),data=await response.json();if(!response.ok)throw Error(data.error);
  leaveData=data;leaveMonth=leaveMonth || data.today.slice(0,7);renderLeave();
 }catch(error){tell(error);}
}
function renderLeave(){
 if(!leaveData)return;
 const monthStart=leaveMonth+"-01",first=dayPlus(monthStart,-((new Date(monthStart+"T12:00:00Z").getUTCDay()+6)%7));
 $("month-title").textContent="Tháng "+Number(leaveMonth.slice(5))+" / "+leaveMonth.slice(0,4);
 $("leave-weekends").checked=leaveData.skipWeekends;
 $("leave-calendar").replaceChildren();
 for(let i=0;i<42;i++){
  const date=dayPlus(first,i),entries=leaveData.registrations.filter(e=>e.from<=date && e.to>=date);
  const all=entries.some(e=>e.scope==="all"),users=new Set(entries.flatMap(e=>e.usernames));
  const button=element("button",undefined,"calendar-day");button.type="button";button.dataset.date=date;
  const weekday=new Date(date+"T12:00:00Z").getUTCDay();
  if(date.slice(0,7)!==leaveMonth)button.classList.add("outside");
  if(leaveData.skipWeekends && [0,6].includes(weekday))button.classList.add("weekend");
  if(date===leaveData.today)button.classList.add("today");
  if(date===selectedLeaveDay)button.classList.add("selected");
  if(all)button.classList.add("global-day");
  button.append(element("span",String(Number(date.slice(8))),"day"));
  if(entries.length)button.append(element("span",all?"Nghỉ chung":users.size+" tài khoản","day-note"));
  button.setAttribute("aria-label",prettyDate(date)+(all?" · Nghỉ chung":entries.length?" · "+users.size+" tài khoản nghỉ":""));
  button.onclick=()=>{selectedLeaveDay=date;leaveMonth=date.slice(0,7);renderLeave();openLeave(undefined,date);};
  $("leave-calendar").append(button);
 }
 const monthEnd=dayPlus(new Date(Date.UTC(+leaveMonth.slice(0,4),+leaveMonth.slice(5),1)).toISOString().slice(0,10),-1);
 const count=leaveData.registrations.filter(e=>e.from<=monthEnd && e.to>=monthStart).length;
 $("leave-count").textContent=count+" đăng ký trong tháng";
 $("leave-selected").hidden=!selectedLeaveDay;
 $("leave-selection-label").textContent=selectedLeaveDay?"Ngày "+prettyDate(selectedLeaveDay):"";
 const search=$("leave-search").value.toLowerCase(),filter=$("leave-filter").value;
 const entries=leaveData.registrations.filter(e=>{
  const matches=selectedLeaveDay?e.from<=selectedLeaveDay && e.to>=selectedLeaveDay:filter==="upcoming"?e.to>=leaveData.today:filter==="month"?e.from<=monthEnd && e.to>=monthStart:true;
  return matches && (e.scope==="all"?"tất cả nghỉ chung":e.usernames.join(" ")).concat(" ",e.note || "").toLowerCase().includes(search);
 }).sort((a,b)=>a.from.localeCompare(b.from)||a.id.localeCompare(b.id));
 $("leave-list").replaceChildren();
 for(const entry of entries.slice(0,leaveLimit)){
  const card=element("article",undefined,"leave-card"),head=element("div",undefined,"card-top");
  head.append(element("h4",entry.from===entry.to?prettyDate(entry.from):prettyDate(entry.from)+" → "+prettyDate(entry.to)));
  head.append(element("span",(Math.round((Date.parse(entry.to)-Date.parse(entry.from))/86400000)+1)+" ngày","small"));card.append(head);
  const tags=element("div",undefined,"leave-tags");
  if(entry.scope==="all")tags.append(element("span","Tất cả tài khoản","tag global"));
  else for(const name of entry.usernames)tags.append(element("span",name,"tag"));
  if(entry.to<leaveData.today)tags.append(element("span","Đã qua","tag"));
  card.append(tags);if(entry.note)card.append(element("p",entry.note));
  const actions=element("div",undefined,"leave-actions"),edit=element("button","Sửa"),remove=element("button","Xóa","danger");
  edit.onclick=()=>openLeave(entry);remove.onclick=()=>removeLeave(entry);actions.append(edit,remove);card.append(actions);$("leave-list").append(card);
 }
 if(!entries.length){const empty=element("div",undefined,"empty-state");empty.append(element("strong","Không có đăng ký nghỉ"),element("span","Bấm “Đăng ký nghỉ” hoặc chọn một ngày trên lịch."));$("leave-list").append(empty);}
 $("leave-more").hidden=entries.length<=leaveLimit;
}
function openLeave(entry,date){
 if(!leaveData)return;
 editingLeaveId=entry?.id;
 $("leave-dialog-title").textContent=entry?"Sửa đăng ký nghỉ":"Đăng ký nghỉ";
 $("leave-from").value=entry?.from || date || selectedLeaveDay || leaveData.today;
 $("leave-to").value=entry?.to || date || selectedLeaveDay || leaveData.today;
 $("leave-scope").value=entry?.scope || "all";$("leave-note").value=entry?.note || "";$("leave-user-search").value="";$("leave-error").textContent="";
 $("leave-form").dataset.requestId=entry?.id || crypto.randomUUID();
 $("leave-user-options").replaceChildren();
 const names=new Set([...leaveData.accounts.map(a=>a.username),...leaveData.registrations.flatMap(e=>e.usernames)]);
 for(const name of names){
  const label=element("label",undefined,"user-option"),input=element("input");input.type="checkbox";input.value=name;input.checked=entry?.usernames.includes(name) || false;
  input.onchange=leavePreview;label.append(input,element("span",name));label.dataset.username=name.toLowerCase();$("leave-user-options").append(label);
 }
 leavePreview();$("leave-dialog").showModal();
}
function leavePreview(){
 const from=$("leave-from").value,to=$("leave-to").value,scope=$("leave-scope").value;
 $("leave-user-picker").hidden=scope!=="users";
 const count=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 const users=[...document.querySelectorAll("#leave-user-options input:checked")].map(input=>input.value);
 $("leave-preview").textContent=Number.isFinite(count)&&count>0?
  count+" ngày · "+(scope==="all"?"Tất cả tài khoản":users.length+" tài khoản đã chọn")+" · Bỏ qua cả IN và OUT":"Chọn ngày bắt đầu và kết thúc hợp lệ.";
}
async function removeLeave(entry){
 if(!confirm("Xóa đăng ký nghỉ "+prettyDate(entry.from)+(entry.to!==entry.from?" → "+prettyDate(entry.to):"")+"? Các đăng ký khác vẫn được giữ."))return;
 try{await post("/api/leave",{action:"delete",id:entry.id,revision:leaveData.revision});await loadLeave();tell("Đã xóa đăng ký nghỉ.");}
 catch(error){tell(error);await loadLeave();}
}
$("leave-form").onsubmit=async event=>{
 event.preventDefault();$("leave-save").disabled=true;$("leave-error").textContent="";
 try{
  const entry={id:$("leave-form").dataset.requestId,scope:$("leave-scope").value,
   usernames:[...document.querySelectorAll("#leave-user-options input:checked")].map(input=>input.value),
   from:$("leave-from").value,to:$("leave-to").value,note:$("leave-note").value.trim()};
  await post("/api/leave",{action:editingLeaveId?"update":"create",revision:leaveData.revision,entry});
  $("leave-dialog").close();await loadLeave();tell(editingLeaveId?"Đã cập nhật đăng ký nghỉ.":"Đã đăng ký nghỉ. Service tự đọc lại lịch mới.");
 }catch(error){$("leave-error").textContent=error.message;}
 finally{$("leave-save").disabled=false;}
};
$("new-leave").onclick=()=>openLeave();
for(const id of ["leave-from","leave-to","leave-scope"])$(id).onchange=leavePreview;
for(const id of ["leave-cancel","leave-back"])$(id).onclick=()=>$("leave-dialog").close();
$("leave-user-search").oninput=()=>{const query=$("leave-user-search").value.toLowerCase();for(const label of $("leave-user-options").children)label.hidden=!label.dataset.username.includes(query);};
$("leave-select-all").onclick=()=>{for(const label of $("leave-user-options").children)if(!label.hidden)label.querySelector("input").checked=true;leavePreview();};
$("leave-weekends").onchange=async()=>{
 try{await post("/api/leave",{action:"weekends",revision:leaveData.revision,skipWeekends:$("leave-weekends").checked});await loadLeave();tell("Đã cập nhật lịch cuối tuần.");}catch(error){tell(error);$("leave-weekends").checked=leaveData.skipWeekends;}
};
function moveMonth(delta){const date=new Date(leaveMonth+"-01T12:00:00Z");date.setUTCMonth(date.getUTCMonth()+delta);leaveMonth=date.toISOString().slice(0,7);selectedLeaveDay=null;renderLeave();}
$("month-prev").onclick=()=>moveMonth(-1);$("month-next").onclick=()=>moveMonth(1);
$("month-today").onclick=()=>{leaveMonth=leaveData.today.slice(0,7);selectedLeaveDay=null;renderLeave();};
$("leave-clear").onclick=()=>{selectedLeaveDay=null;renderLeave();};
$("leave-filter").onchange=()=>{selectedLeaveDay=null;leaveLimit=20;renderLeave();};
$("leave-search").oninput=()=>{leaveLimit=20;renderLeave();};$("leave-more").onclick=()=>{leaveLimit+=20;renderLeave();};

async function loadHistory({apply=false}={}){
 if(!snapshot)return;
 if(apply || !historyRange)historyRange={from:$("history-from").value || snapshot.today,to:$("history-to").value || $("history-from").value || snapshot.today};
 const {from,to}=historyRange,request=++historyLoading;
 try{
  const response=await fetch("/api/history?"+new URLSearchParams({from,to}),{cache:"no-store"}),result=await response.json();
  if(!response.ok)throw Error(result.error);if(request!==historyLoading)return;
  historyData=result;renderHistory();
 }catch(error){if(request===historyLoading)tell(error);}
}
function needsReview(job){return job && (["failed","unknown","missed","clicked"].includes(job.status) || (job.status==="pending" && job.lastError));}
function jobCell(container,job){
 const box=element("div",undefined,"job-cell");
 if(!job){box.append(element("span","Chưa có lượt","muted"));container.append(box);return;}
 box.append(element("span",labels[job.status] || job.status,"badge "+job.status));
 box.append(element("div","Hẹn "+due(job.due)+" · Chạy "+time(job.startedAt),"job-times"));
 if(job.nextRetryAt)box.append(element("div","Thử lại "+time(job.nextRetryAt),"small"));
 if(job.lastError && job.status!=="success")box.append(element("div",job.lastError,"job-error"));
 container.append(box);
}
function renderHistory(){
 if(!historyData)return;
 const search=$("history-search").value.toLowerCase(),errors=$("history-errors").checked;
 const groups=historyData.groups.filter(item=>item.username.toLowerCase().includes(search) && (!errors || needsReview(item.IN) || needsReview(item.OUT)));
 $("history-range").textContent=prettyDate(historyData.from)+(historyData.to!==historyData.from?" → "+prettyDate(historyData.to):"");
 $("history-summary").textContent=groups.length+" dòng · "+historyData.rows.length+" lần thử trong khoảng ngày";
 $("historyrows").replaceChildren();
 for(const item of groups){
  const row=element("tr");row.tabIndex=0;row.setAttribute("aria-label","Chi tiết "+item.username+" ngày "+prettyDate(item.date));
  const user=cell(row,"");user.append(element("div",item.username,"history-user"),element("div",prettyDate(item.date),"history-date"));
  jobCell(cell(row,""),item.IN);jobCell(cell(row,""),item.OUT);
  cell(row,(item.IN?.attempts || 0)+(item.OUT?.attempts || 0)+" lần");
  const actions=cell(row,""),detail=element("button","Chi tiết");detail.onclick=event=>{event.stopPropagation();showAttempts(item);};actions.append(detail);
  row.onclick=()=>showAttempts(item);row.onkeydown=event=>{if(event.key==="Enter" || event.key===" "){event.preventDefault();showAttempts(item);}};$("historyrows").append(row);
 }
 if(!groups.length){const row=element("tr"),td=cell(row,"Không có lịch sử phù hợp. Thử đổi khoảng ngày hoặc tắt bộ lọc lỗi.");td.colSpan=5;td.className="empty-state";$("historyrows").append(row);}
}
function showAttempts(item){
 $("attempts-title").textContent=item.username;$("attempts-subtitle").textContent=prettyDate(item.date)+" · IN & OUT · Chi tiết từng lần thử";
 $("attempts-summary").replaceChildren();$("attempts-list").replaceChildren();
 for(const mode of ["IN","OUT"]){
  const pane=element("div");pane.append(element("h3",mode==="IN"?"IN · Buổi sáng":"OUT · Buổi chiều"));jobCell(pane,item[mode]);
  if(item.date===snapshot.today){const button=element("button","Chạy lại "+mode);button.style.marginTop="12px";button.disabled=item[mode]?.status==="running";button.onclick=()=>execute("user",item.username,{mode,date:item.date});pane.append(button);}
  $("attempts-summary").append(pane);
 }
 const records=historyData.rows.filter(r=>r.date===item.date && r.username===item.username);
 for(const record of records){
  const row=element("article",undefined,"attempt-row"),content=element("div"),log=element("button","Xem log");
  content.append(element("h4",record.mode+" · Lần "+(record.attempt || "—")+(record.legacy?" · dữ liệu cũ":"")));
  content.append(element("span",labels[record.status] || record.status,"badge "+record.status),element("span",time(record.startedAt)+" → "+time(record.finishedAt),"small"));
  if(record.reason)content.append(element("p",record.reason));
  if(record.connection && !record.connection.ok)content.append(element("p","Kết nối: "+record.connection.results.filter(r=>!r.ok).map(r=>r.name+" "+r.error).join("; ")));
  log.onclick=async()=>{
   $("logtitle").textContent=item.username+" · "+record.mode+" · Lần "+record.attempt;$("logtext").textContent="Đang tải…";$("logs").showModal();
   try{const data=await (await fetch("/api/log?"+new URLSearchParams({date:record.date,eventId:record.id}))).json();$("logtext").textContent=data.text || data.error;}
   catch(error){$("logtext").textContent=error.message;}
  };
  row.append(content,log);$("attempts-list").append(row);
 }
 if(!records.length)$("attempts-list").append(element("div","Chưa có lần thử. Lượt có thể đang chờ giờ hoặc đã quá giờ mà chưa chạy.","empty-state"));
 $("attempts-dialog").showModal();
}
function historyShortcut(days){
 $("history-to").value=days===-1?dayPlus(snapshot.today,-1):snapshot.today;
 $("history-from").value=days===7?dayPlus(snapshot.today,-6):$("history-to").value;
 for(const [id,n]of [["history-today",0],["history-yesterday",-1],["history-week",7]])$(id).classList.toggle("active",n===days);
 loadHistory({apply:true});
}
$("history-today").onclick=()=>historyShortcut(0);$("history-yesterday").onclick=()=>historyShortcut(-1);$("history-week").onclick=()=>historyShortcut(7);
$("history-apply").onclick=()=>loadHistory({apply:true});$("history-search").oninput=renderHistory;$("history-errors").onchange=renderHistory;
$("attempts-close").onclick=()=>$("attempts-dialog").close();
