import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
const PUBLIC_URL='https://risk-radar-ybd-20261019.ybd3671.chatgpt.site';
async function verify({url=PUBLIC_URL,token=null}){
 let cookie='';const baseHeaders=token?{'OAI-Sites-Authorization':'Bearer '+token}:{};
 async function call(p,method='GET',body,session='current',expected=200){const headers={...baseHeaders,'Content-Type':'application/json'};if(session==='current'&&cookie)headers.Cookie=cookie;if(p==='/api/tick'&&token)headers.Authorization='Bearer '+token;const r=await fetch(url+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});if(session==='current'&&r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,expected,p);return r.json();}
 const health=await call('/api/health');assert.equal(health.storage,'D1 服务端持久化');console.log('PASS cloud health and D1');
 const parsed=await call('/api/parse','POST',{text:'沪深300当日跌幅超过2%，冷却60分钟'});assert.equal(parsed.rule.conditions[0].op,'lt');
 const task=await call('/api/tasks','POST',{title:'验收示例 · 沪深300',rule:parsed.rule,mode:'demo'},'current',201);
 assert.equal((await call('/api/tasks/'+task.id+'/run','POST',{scenario:'normal'})).kind,'clear');
 assert.equal((await call('/api/tasks/'+task.id+'/run','POST',{scenario:'trigger'})).alert,true);
 assert.equal((await call('/api/tasks/'+task.id+'/run','POST',{scenario:'trigger'})).status,'cooldown');
 for(const scenario of ['stale','missing','conflict','failure'])assert.equal((await call('/api/tasks/'+task.id+'/run','POST',{scenario})).kind,'degraded');
 assert.equal((await call('/api/tasks/'+task.id+'/run','POST',{scenario:'normal'})).recovered,true);
 const updated=await call('/api/tasks/'+task.id,'PUT',{rule:{...parsed.rule,cooldownMinutes:5}});assert.equal(updated.version,2);
 await call('/api/tasks/'+task.id+'/pause','POST',{});await call('/api/tasks/'+task.id+'/run','POST',{},'current',400);
 const other=await call('/api/state','GET',undefined,'other');assert.equal(other.tasks.length,0);await call('/api/tasks/'+task.id+'/resume','POST',{},'other',404);
 console.log('PASS public workspace isolation, create, evidence, cooldown, all failures, recovery, version and pause');
 if(token){await call('/api/tasks/'+task.id+'/resume','POST',{});await call('/api/tick','POST',{});const state=await call('/api/state');assert.ok(state.logs.some(l=>l.taskId===task.id&&l.manual===false));const h=await call('/api/health');assert.ok(h.schedulerLastTick);await call('/api/tasks/'+task.id+'/pause','POST',{});console.log('PASS authorized unattended tick, persisted automatic record and heartbeat');}
 else await call('/api/tick','POST',{},'current',401);
 const state=await call('/api/state');assert.ok(state.tasks.some(t=>t.id===task.id));assert.ok(state.logs.filter(l=>l.taskId===task.id).length>=8);assert.ok(state.logs.some(l=>l.version===1));
 const source=await fetch(url+'/source',{headers:baseHeaders,redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(source.status,200);assert.match(await source.text(),/git clone/);const archive=await fetch(url+'/source.zip',{headers:baseHeaders,redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(archive.status,200);assert.match(archive.headers.get('content-type'),/zip/);
 console.log('PASS source browser, download and cloud readback');
 if(process.argv.includes('--clone')){await mkdir('.sites-runtime',{recursive:true});const dest=path.resolve('.sites-runtime','clone-'+Date.now());const clone=spawnSync('git',['clone',url+'/repository/sentinel.git',dest],{encoding:'utf8',timeout:60000});assert.equal(clone.status,0,clone.stderr);const tests=spawnSync(process.execPath,['--test','tests/engine.test.mjs','tests/service.test.mjs','tests/public.test.mjs'],{cwd:dest,encoding:'utf8',timeout:30000});assert.equal(tests.status,0,tests.stdout+tests.stderr);console.log('PASS anonymous Git clone and tests from cloned source');}
 const report={verifiedAt:new Date().toISOString(),url,cloudStorage:true,lifecycle:true,isolation:true,sourceBrowser:true,sourceDownload:true,gitClone:process.argv.includes('--clone'),unattendedWriter:!!token,tests:'21 automated checks',video:'Deferred by user',limitations:['Constructed demonstration market data','Finite-grammar parser; model connector implemented but unconfigured']};
 await writeFile(path.resolve('..','哨点Sentinel_线上验收.json'),JSON.stringify(report,null,2));console.log('ONLINE VERIFICATION PASSED');
}
if(process.argv.includes('--public'))verify({}).catch(e=>{console.error(e.message);process.exitCode=1;});
else{if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();console.log('Ready for verification JSON on stdin (hidden).');let input='';process.stdin.on('data',chunk=>{input+=chunk.toString();if(input.includes('\u0003'))process.exit(130);if(!input.trim().endsWith('}'))return;process.stdin.removeAllListeners('data');process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);const data=JSON.parse(input.trim());input='';verify(data).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>process.stdin.destroy());});}
