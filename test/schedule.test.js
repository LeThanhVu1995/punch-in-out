
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {plan,localTime,clock} = require("../service/schedule");
const cfg = {timezone:"Asia/Ho_Chi_Minh",weekdays:[1,2,3,4,5],
  windows:{IN:{from:"07:20",to:"08:30"},OUT:{from:"17:40",to:"18:35"}}};
const accounts=[{username:"test",password:"placeholder"}];
test("Vietnam date and weekday",()=>{
  assert.equal(localTime(new Date("2026-10-14T00:20:00Z"),cfg.timezone).seconds,clock("07:20"));
});
test("persists separate random windows and skips weekends",()=>{
  const state={};plan(cfg,{},accounts,state,new Date("2026-10-14T00:00:00Z"));
  const before=JSON.stringify(state);
  plan(cfg,{},accounts,state,new Date("2026-10-14T00:01:00Z"));
  assert.equal(JSON.stringify(state),before);
  const jobs=Object.values(state);assert.equal(jobs.length,2);
  for(const j of jobs) {assert.ok(j.due>=clock(cfg.windows[j.mode].from));assert.ok(j.due<=clock(cfg.windows[j.mode].to));}
  const weekend={};plan(cfg,{},accounts,weekend,new Date("2026-10-17T00:30:00Z"));
  assert.deepEqual(weekend,{});
});
test("holidays skip all or individual accounts",()=>{
  for(const off of [{global:["2026-10-14"]},{users:{test:["2026-10-14"]}}]) {
    const state={};assert.equal(plan(cfg,off,accounts,state,new Date("2026-10-14T00:30:00Z")).jobs.length,0);
    assert.deepEqual(state,{});
  }
});
test("overdue in window runs once; beyond window is missed",()=>{
  const key=JSON.stringify(["2026-10-14","test","IN"]);
  const state={[key]:{date:"2026-10-14",username:"test",mode:"IN",due:clock("07:20"),status:"pending"}};
  assert.equal(plan(cfg,{},accounts,state,new Date("2026-10-14T01:00:00Z")).jobs.length,1);
  state[key].status="running";
  assert.equal(plan(cfg,{},accounts,state,new Date("2026-10-14T01:01:00Z")).jobs.length,0);
  state[key].status="pending";
  plan(cfg,{},accounts,state,new Date("2026-10-14T01:31:00Z"));
  assert.equal(state[key].status,"missed");
});
test("rejects invalid windows",()=>{
  assert.throws(()=>clock("25:00"));
  assert.throws(()=>plan({...cfg,windows:{...cfg.windows,IN:{from:"08:30",to:"07:20"}}},{},accounts,{}));
});
