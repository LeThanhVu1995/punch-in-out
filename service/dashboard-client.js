let snapshot,initialized=false,busy=false,view="monitor",editor;
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
 $("clicked").textContent=jobs.filter(j=>["success","clicked"].includes(j.status)).length;
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
async function execute(scope,username){
 if(busy || !snapshot || snapshot.date!==snapshot.today)return;
 const mode=$("mode").value;
 const targets=snapshot.jobs.filter(j=>j.mode===mode && (scope!=="user" || j.username===username) &&
   (scope!=="failed" || ["failed","unknown","missed"].includes(j.status)));
 if(!targets.length){$("message").textContent="Không có lượt lỗi để chạy lại.";return;}
 const risky=targets.some(j=>["success","clicked","unknown"].includes(j.status));
 const prompt="Chạy "+mode+" ngay cho "+(scope==="user"?username:targets.length+" tài khoản")+"? Bỏ qua giờ hẹn và ngày nghỉ hôm nay."+
   (risky?" Có lượt đã bấm hoặc chưa rõ kết quả. Chỉ tiếp tục khi bạn đã kiểm tra và chấp nhận bấm lại.":"");
 if(!window.confirm(prompt))return;
 busy=true;for(const id of ["activate","failed"])$(id).disabled=true;render();
 try{
   const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json","X-Punch-Token":snapshot.token},
     body:JSON.stringify({requestId:crypto.randomUUID(),mode,scope,username,confirmRepeat:risky})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error);
   $("message").textContent="Đã xếp "+result.queued+" tài khoản chạy ngay; bỏ qua "+result.skipped+" lượt đang chạy hoặc yêu cầu trùng.";
 }catch(error){$("message").textContent="Không xếp được lượt: "+error.message;}
 finally{busy=false;for(const id of ["activate","failed"])$(id).disabled=false;await refresh();}
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
async function loadHistory(){
 try{
  const response=await fetch("/api/history?date="+snapshot.date),result=await response.json();
  if(!response.ok)throw Error(result.error);
  $("historydate").textContent=result.date;$("historyrows").replaceChildren();
  for(const record of result.rows){
   const row=document.createElement("tr");cell(row,record.username+" · "+record.mode);
   cell(row,String(record.attempt || "—")+(record.legacy?" · cũ":""));cell(row,labels[record.status] || record.status);
   cell(row,time(record.startedAt)+" → "+time(record.finishedAt));
   cell(row,record.reason || (record.verification?.verified?"Phản hồi website xác nhận":""));
   const action=cell(row,""),button=document.createElement("button");button.textContent="Log";button.onclick=async()=>{
    $("logtitle").textContent=record.username+" · lần "+record.attempt;$("logtext").textContent="Đang tải…";$("logs").showModal();
    const data=await (await fetch("/api/log?"+new URLSearchParams({date:snapshot.date,eventId:record.id}))).json();$("logtext").textContent=data.text || data.error;
   };action.append(button);$("historyrows").append(row);
  }
 }catch(error){tell(error);}
}
async function selectView(next){
 view=next;for(const name of ["monitor","history","settings"]){$(name).hidden=name!==view;$("tab-"+name).classList.toggle("active",name===view);}
 if(view==="history")await loadHistory();if(view==="settings" && !editor)await loadEditor();
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
  $("global-holidays").value=editor.holidays.global.join("\n");$("skip-weekends").checked=editor.holidays.skipWeekends!==false;
  $("holidayrows").replaceChildren();
  const names=new Set([...editor.accounts.map(a=>a.username),...Object.keys(editor.holidays.users)]);
  for(const name of names){
   const row=document.createElement("tr");row.dataset.username=name;cell(row,name);
   const td=cell(row,""),input=document.createElement("textarea");input.value=(editor.holidays.users[name] || []).join("\n");td.append(input);$("holidayrows").append(row);
  }
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
$("save-holidays").onclick=async()=>{
 if(!editor)return;try{
  const dates=text=>text.split(/[\s,]+/).filter(Boolean);
  const holidays={...editor.holidays,global:dates($("global-holidays").value),skipWeekends:$("skip-weekends").checked,
   users:Object.fromEntries([...$("holidayrows").children].map(row=>[row.dataset.username,dates(row.querySelector("textarea").value)]))};
  await post("/api/holidays",{revision:editor.holidaysRevision,holidays});tell("Đã lưu ngày nghỉ.");await loadEditor();await refresh();
 }catch(error){tell(error);}
};
for(const name of ["monitor","history","settings"])$("tab-"+name).onclick=()=>selectView(name);
$("load-editor").onclick=loadEditor;$("add-account").onclick=()=>addAccount();$("history-refresh").onclick=loadHistory;
$("date").onchange=refresh;$("today").onclick=()=>{$("date").value=snapshot.today;refresh();};
$("check-network").onclick=async()=>{try{$("check-network").disabled=true;const result=await post("/api/check",{});tell(result.ok?"Website truy cập được. Kiểm tra này không chấm công.":result.results.filter(r=>!r.ok).map(r=>r.name+": "+r.error).join("; "));await refresh();}catch(error){tell(error);}finally{$("check-network").disabled=false;}};
