import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createStore} from '../src/store.mjs';import {makeService} from '../src/service.mjs';import {parseLocal} from '../src/engine.mjs';
test('complete persisted lifecycle: create, trigger, cooldown, failure, recover, edit, pause',async()=>{
 const db=new DatabaseSync(':memory:'),s=makeService(createStore(db),{LOCAL_SCHEDULER:'1'}),rule=parseLocal('沪深300当日跌幅超过2%').rule;
 const call=async(path,method='GET',body)=>{const r=await s.handle(new Request('http://localhost/api'+path,{method,body:body===undefined?undefined:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
 let res=await call('/tasks','POST',{rule,mode:'demo',title:'test'});assert.equal(res.status,201);const id=res.data.id;
 assert.equal((await call('/tasks/'+id+'/run','POST',{scenario:'trigger'})).data.alert,true);
 assert.equal((await call('/tasks/'+id+'/run','POST',{scenario:'trigger'})).data.status,'cooldown');
 assert.equal((await call('/tasks/'+id+'/run','POST',{scenario:'failure'})).data.kind,'degraded');
 assert.equal((await call('/tasks/'+id+'/run','POST',{scenario:'normal'})).data.recovered,true);
 assert.equal((await call('/tasks/'+id,'PUT',{rule:{...rule,cooldownMinutes:5}})).data.version,2);
 await call('/tasks/'+id+'/pause','POST',{});assert.equal((await call('/tasks/'+id+'/run','POST',{})).status,400);
 const reloaded=await createStore(db).tasks();assert.equal(reloaded[0].status,'paused');assert.equal(reloaded[0].versions.length,2);
 assert.equal((await call('/state')).data.logs.length,4);
 assert.equal((await call('/tasks','POST',{rule,mode:'live'})).status,400);
 assert.equal((await call('/tick','POST',{})).status,401);db.close();
});
test('tick executes only due active tasks and preserves pauses',async()=>{const db=new DatabaseSync(':memory:'),store=createStore(db),s=makeService(store,{}),rule=parseLocal('沪深300当日跌幅超过2%').rule;await store.putTask({id:'active',rule,title:'active',mode:'demo',status:'running',version:1,nextRunAt:0,createdAt:1});await store.putTask({id:'paused',rule,title:'paused',mode:'demo',status:'paused',version:1,nextRunAt:0,createdAt:2});assert.equal((await s.tick()).checked,1);assert.equal((await s.tick()).checked,0);assert.equal((await store.logs()).length,1);db.close();});
test('simultaneous checks on the same task do not duplicate alert',async()=>{const db=new DatabaseSync(':memory:'),store=createStore(db),s=makeService(store,{}),rule=parseLocal('沪深300当日跌幅超过2%').rule;await store.putTask({id:'concurrent',rule,title:'concurrent',mode:'demo',status:'running',version:1,nextRunAt:0,createdAt:1});const responses=await Promise.all(Array.from({length:3},()=>s.handle(new Request('http://localhost/api/tasks/concurrent/run',{method:'POST',body:JSON.stringify({scenario:'trigger'})}))));const logs=await Promise.all(responses.map(r=>r.json()));assert.equal(logs.filter(l=>l.alert).length,1);db.close();});
