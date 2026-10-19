export function createStore(db,kind='sqlite') {
 const query=(sql,args=[])=>kind==='sqlite'?Promise.resolve(db.prepare(sql).all(...args)):db.prepare(sql).bind(...args).all().then(x=>x.results);
 const execute=(sql,args=[])=>kind==='sqlite'?Promise.resolve(db.prepare(sql).run(...args)):db.prepare(sql).bind(...args).run();
 let ready;
 const init=()=>ready||=(async()=>{
   // Worker ESM owns these two tables directly; they are not Drizzle/migration-owned.
   await execute('CREATE TABLE IF NOT EXISTS sentinel_tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
   await execute('CREATE TABLE IF NOT EXISTS sentinel_logs (id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)');
   await execute('CREATE TABLE IF NOT EXISTS sentinel_meta (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
 })().catch(e=>{ready=null;throw e;});
 return {
  async getMeta(id){await init();return (await query('SELECT payload FROM sentinel_meta WHERE id=?',[id])).map(x=>JSON.parse(x.payload))[0]||null;},
  async setMeta(id,value){await init();await execute('INSERT INTO sentinel_meta (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[id,JSON.stringify(value)]);},
  async tasks(){await init();return (await query('SELECT payload FROM sentinel_tasks')).map(x=>JSON.parse(x.payload)).sort((a,b)=>b.createdAt-a.createdAt);},
  async logs(){await init();return (await query('SELECT payload FROM sentinel_logs ORDER BY at DESC LIMIT 500')).map(x=>JSON.parse(x.payload));},
  async putTask(t){await init();await execute('INSERT INTO sentinel_tasks (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[t.id,JSON.stringify(t)]);},
  async addLog(l){await init();await execute('INSERT INTO sentinel_logs (id,at,payload) VALUES (?,?,?)',[l.id,l.at,JSON.stringify(l)]);await execute('DELETE FROM sentinel_logs WHERE id NOT IN (SELECT id FROM sentinel_logs ORDER BY at DESC LIMIT 500)');}
  ,async commitRun(t,l,expected){
   await init();const payload=JSON.stringify(t);
   const update='UPDATE sentinel_tasks SET payload=? WHERE id=? AND payload=?';
   const insert='INSERT INTO sentinel_logs (id,at,payload) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM sentinel_tasks WHERE id=? AND payload=?)';
   const trim='DELETE FROM sentinel_logs WHERE id NOT IN (SELECT id FROM sentinel_logs ORDER BY at DESC LIMIT 500)';
   if(kind==='sqlite'){
    db.exec('BEGIN IMMEDIATE');try{const changed=db.prepare(update).run(payload,t.id,expected).changes;if(changed){db.prepare(insert).run(l.id,l.at,JSON.stringify(l),t.id,payload);db.prepare(trim).run();}db.exec('COMMIT');return !!changed;}catch(e){db.exec('ROLLBACK');throw e;}
   }
   const result=await db.batch([db.prepare(update).bind(payload,t.id,expected),db.prepare(insert).bind(l.id,l.at,JSON.stringify(l),t.id,payload),db.prepare(trim)]);
   return result[0].meta.changes>0;
  }
 };
}
