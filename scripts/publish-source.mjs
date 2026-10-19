// Portable wrapper for the native Sites workflow; credentials only arrive on stdin.
import {spawn,spawnSync} from 'node:child_process';import {readFile,readdir} from 'node:fs/promises';import path from 'node:path';
const pluginRoot=process.argv[2];if(!pluginRoot)throw Error('Provide the installed Sites plugin root');
if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();console.log('Ready for source credential JSON on stdin (hidden).');let input='';
process.stdin.on('data',chunk=>{input+=chunk.toString();if(input.includes('\u0003'))process.exit(130);if(!input.trim().endsWith('}'))return;process.stdin.removeAllListeners('data');process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);const data=JSON.parse(input.trim());input='';publish(data).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>process.stdin.destroy());});
async function publish({credential}){
 const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8')),root=process.cwd(),archive=path.join(root,'site.tar.gz');
 const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:root};
 const helper=path.join(pluginRoot,'scripts','site-workflow.mjs');
 const testFiles=(await readdir('tests')).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f);
 const child=spawn(process.execPath,[helper,'--project-id',manifest.project_id],{env,stdio:['pipe','pipe','pipe']});let output='',errors='';
 child.stdout.on('data',c=>{output+=c.toString();});child.stderr.on('data',c=>{errors+=c.toString();});
 child.stdin.end(JSON.stringify({credential,source:{project_id:manifest.project_id,checkout_path:root},commands:[['node','--test',...testFiles],['node','scripts/build.mjs'],['node','scripts/validate-artifact.mjs']],archivePath:archive})+'\n');
 const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
 const git=(args)=>{const r=spawnSync('git',args,{env,encoding:'utf8'});if(r.status!==0)throw Error('Git verification failed');return r.stdout.trim();};
 if(code!==0){if(!errors.includes('package-site.sh')||!errors.includes('No such file'))throw Error(errors.split(credential.token).join('[redacted]')||'Source workflow failed');
  // The native helper verifies the push before invoking its incompatible Windows packager.
  const tar=spawnSync('tar',['-czf',archive,'dist'],{encoding:'utf8'});if(tar.status!==0)throw Error('Native archive creation failed');console.log('Used native Windows tar after the known Sites Bash path failure.');
 }
 if(git(['status','--porcelain']))throw Error('Source changed during publishing');
 console.log(JSON.stringify({project_id:manifest.project_id,checkout_path:root,commit_sha:git(['rev-parse','HEAD']),archive}));
}
