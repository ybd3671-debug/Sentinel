import {readFile,mkdir,writeFile} from 'node:fs/promises';
const engine=await readFile('src/engine.mjs','utf8');
const service=(await readFile('src/service.mjs','utf8')).replace(/^import .*?;\r?\n/,'');
const store=await readFile('src/store.mjs','utf8');
const html=await readFile('public/index.html','utf8');
const js=await readFile('public/app.js','utf8');
const worker=engine+'\n'+store+'\n'+service+'\n'+`const HTML=${JSON.stringify(html)},JS=${JSON.stringify(js)};
let cachedDB,cachedService;
function service(env){if(!env.DB)throw Error('D1 binding DB not configured');if(cachedDB!==env.DB){cachedDB=env.DB;cachedService=makeService(createStore(env.DB,'d1'),env);}return cachedService;}
export default {async fetch(request,env){const u=new URL(request.url);try{if(u.pathname.startsWith('/api/')){if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==u.origin)return Response.json({error:'Origin rejected'},{status:403});return await service(env).handle(request);}if(!['/','/app.js'].includes(u.pathname))return new Response('Not found',{status:404});return new Response(u.pathname==='/app.js'?JS:HTML,{headers:{'Content-Type':u.pathname==='/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}});}catch{return Response.json({error:'服务端存储不可用，请检查 D1 绑定'},{status:503});}},async scheduled(event,env,ctx){ctx.waitUntil(service(env).tick());}};
`;
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await writeFile('worker/index.js',worker);await writeFile('dist/server/index.js',worker);await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
console.log('Built Worker ESM with embedded UI.');
