import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from './src/store.mjs';
import {makeService} from './src/service.mjs';
import {sourceRoute} from './src/review.mjs';
const review=(await import('./src/review-generated.mjs').catch(()=>({default:null}))).default;
await mkdir(new URL('./data/',import.meta.url),{recursive:true});
const db=new DatabaseSync(fileURLToPath(new URL('./data/sentinel.sqlite',import.meta.url)));
const env={...process.env,LOCAL_SCHEDULER:'1'};
const service=makeService(createStore(db),env);
const html=await readFile(new URL('./public/index.html',import.meta.url),'utf8');
const js=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost:'+ (env.PORT||8787));
 if(req.method!=='GET'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){res.writeHead(403);res.end('Origin rejected');return;}
 let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>20000){res.writeHead(413);res.end('Payload too large');return;}chunks.push(part);}
 if(url.pathname.startsWith('/api/')){const response=await service.handle(new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;}
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 if(review){const source=sourceRoute(url,review);if(source){res.writeHead(source.status,Object.fromEntries(source.headers));res.end(Buffer.from(await source.arrayBuffer()));return;}}
 if(!['/','/app.js'].includes(url.pathname)){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':url.pathname==='/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(url.pathname==='/app.js'?js:html);
 }catch{res.writeHead(500);res.end('Service unavailable');}
});
const timer=setInterval(()=>service.tick().catch(e=>console.error('Scheduler failed:',e.message)),30000);timer.unref();
server.listen(Number(env.PORT||8787),'127.0.0.1',()=>console.log('Sentinel running: http://127.0.0.1:'+(env.PORT||8787)));
