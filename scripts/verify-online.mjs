import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {mkdir,writeFile,readdir} from 'node:fs/promises';import path from 'node:path';
const PUBLIC_URL=process.env.VERIFY_URL||'https://risk-radar-ybd-20261019.ybd3671.chatgpt.site';
async function verify({url=PUBLIC_URL,token=null}){
 const cookies=new Map();const baseHeaders=token?{'OAI-Sites-Authorization':'Bearer '+token}:{};
 async function call(p,method='GET',body,session='current',expected=200){
  const headers={...baseHeaders,'Content-Type':'application/json'};
  if(session==='current'&&cookies.size)headers.Cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');
  if(p==='/api/tick'&&token)headers.Authorization='Bearer '+token;
  const r=await fetch(url+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(session==='current')for(const line of r.headers.getSetCookie()){const pair=line.split(';')[0],i=pair.indexOf('=');if(i>0)cookies.set(pair.slice(0,i),pair.slice(i+1));}
  if(r.status!==expected)console.error('HTTP_DIAGNOSTIC',JSON.stringify({path:p,status:r.status,sentSession:session==='current',storedCookieNames:[...cookies.keys()]}));
  assert.equal(r.status,expected,p);return r.json();
 }
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
 let publicQuoteVerified=false;
 if(process.argv.includes('--market')){const real=await call('/api/tasks','POST',{title:'验收 · 腾讯真实报价',rule:parsed.rule,mode:'public'},'current',201);const result=await call('/api/tasks/'+real.id+'/run','POST',{});assert.ok(result.snapshot?.raw?.fields,'Public quote request did not produce traceable source data');assert.match(result.snapshot.source,/腾讯/);assert.ok(result.snapshot.asOf);assert.ok(result.snapshot.fetchedAt);await call('/api/tasks/'+real.id+'/pause','POST',{});publicQuoteVerified=true;console.log('PASS real public quote fetch, source time and raw fields; decision='+result.kind);}
 if(process.argv.includes('--clone')){await mkdir('.sites-runtime',{recursive:true});const dest=path.resolve('.sites-runtime','clone-'+Date.now());const clone=spawnSync('git',['clone',url+'/repository/sentinel.git',dest],{encoding:'utf8',timeout:60000});assert.equal(clone.status,0,clone.stderr);const files=(await readdir(path.join(dest,'tests'))).filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f);const tests=spawnSync(process.execPath,['--test',...files],{cwd:dest,encoding:'utf8',timeout:30000});assert.equal(tests.status,0,tests.stdout+tests.stderr);console.log('PASS anonymous Git clone and tests from cloned source');}
 const report={verifiedAt:new Date().toISOString(),url,environment:new URL(url).hostname==='127.0.0.1'?'local compiled Worker with D1 adapter emulation':'deployed',lifecycle:true,isolation:true,sourceBrowser:true,sourceDownload:true,publicQuoteVerified,schedulerLastTick:health.schedulerLastTick,gitClone:process.argv.includes('--clone'),unattendedWriter:!!token,tests:'all tests/*.test.mjs',video:'Deferred by user',limitations:['Public quotes may be delayed; demo mode uses constructed data','Finite-grammar parser; model connector implemented but unconfigured']};
 await writeFile(path.resolve('..','哨点Sentinel_线上验收.json'),JSON.stringify(report,null,2));console.log('VERIFICATION_REPORT',JSON.stringify(report));console.log('ONLINE VERIFICATION PASSED');
}
if(process.argv.includes('--public'))verify({token:process.env.VERIFY_TOKEN||null}).catch(e=>{console.error(e.message);process.exitCode=1;});
else{if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();console.log('Ready for verification JSON on stdin (hidden).');let input='';process.stdin.on('data',chunk=>{input+=chunk.toString();if(input.includes('\u0003'))process.exit(130);if(!input.trim().endsWith('}'))return;process.stdin.removeAllListeners('data');process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);const data=JSON.parse(input.trim());input='';verify(data).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>process.stdin.destroy());});}

