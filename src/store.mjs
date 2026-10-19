export function createStore(db,kind='sqlite') {
 const query=(sql,args=[])=>kind==='sqlite'?Promise.resolve(db.prepare(sql).all(...args)):db.prepare(sql).bind(...args).all().then(x=>x.results);
 const execute=(sql,args=[])=>kind==='sqlite'?Promise.resolve(db.prepare(sql).run(...args)):db.prepare(sql).bind(...args).run();
 let ready;
 const init=()=>ready||=(async()=>{
   // Worker ESM owns these two tables directly; they are not Drizzle/migration-owned.
   await execute('CREATE TABLE IF NOT EXISTS sentinel_tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
   await execute('CREATE TABLE IF NOT EXISTS sentinel_logs (id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)');
 })().catch(e=>{ready=null;throw e;});
 return {
  async tasks(){await init();return (await query('SELECT payload FROM sentinel_tasks')).map(x=>JSON.parse(x.payload)).sort((a,b)=>b.createdAt-a.createdAt);},
  async logs(){await init();return (await query('SELECT payload FROM sentinel_logs ORDER BY at DESC LIMIT 500')).map(x=>JSON.parse(x.payload));},
  async putTask(t){await init();await execute('INSERT INTO sentinel_tasks (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[t.id,JSON.stringify(t)]);},
  async addLog(l){await init();await execute('INSERT INTO sentinel_logs (id,at,payload) VALUES (?,?,?)',[l.id,l.at,JSON.stringify(l)]);await execute('DELETE FROM sentinel_logs WHERE id NOT IN (SELECT id FROM sentinel_logs ORDER BY at DESC LIMIT 500)');}
 };
}
