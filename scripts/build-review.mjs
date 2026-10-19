import {mkdir,readFile,readdir,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
export async function buildReview(){
 const root=process.cwd(),stage=path.join(root,'.sites-runtime','review-'+Date.now());await mkdir(stage,{recursive:true});
 const files={};
 async function collect(dir){for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.name==='review-generated.mjs')continue;if(e.isDirectory())await collect(p);else if(e.isFile())files[p]=await readFile(path.join(root,p),'utf8');}}
 for(const dir of ['src','public','scripts','tests','docs'])await collect(dir);
 for(const p of ['README.md','package.json','server.mjs','.env.example','.gitignore','.openai/hosting.json'])files[p]=await readFile(path.join(root,p),'utf8');
 // Only this explicit allowlist is published; no local Git history, data, env or credentials.
 for(const [p,content] of Object.entries(files)){await mkdir(path.dirname(path.join(stage,p)),{recursive:true});await writeFile(path.join(stage,p),content);}
 const git=(args)=>{const r=spawnSync('git',args,{cwd:stage,encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:'2026-10-19T00:00:00+08:00',GIT_COMMITTER_DATE:'2026-10-19T00:00:00+08:00'}});if(r.status!==0)throw Error(r.stderr||'Git snapshot build failed');return r.stdout.trim();};
 git(['init','--initial-branch=main']);git(['add','.']);git(['-c','user.name=Sentinel Source','-c','user.email=source@sentinel.invalid','commit','-m','Reviewable Sentinel source snapshot']);git(['update-server-info']);
 const sha=git(['rev-parse','HEAD']);const objects={};
 async function readGit(dir){for(const e of await readdir(path.join(stage,'.git',dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await readGit(p);else objects[p]=(await readFile(path.join(stage,'.git',p))).toString('base64');}}
 await readGit('objects');await readGit('refs');for(const p of ['HEAD','info/refs'])objects[p]=(await readFile(path.join(stage,'.git',p))).toString('base64');
 const archive=path.join(stage,'snapshot.zip');git(['archive','--format=zip','--output='+archive,'HEAD']);
 return {sha,files,objects,zip:(await readFile(archive)).toString('base64')};
}
