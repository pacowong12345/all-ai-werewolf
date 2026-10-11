import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRemoteGateway,validateRemoteAccount,type RemoteAccount} from '../server/remote-gateway.js';
// Installer only downloads the official release with a verified SHA-256 digest.
// @ts-ignore standalone JS helper
import {installTunnel} from './install-tunnel.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));process.chdir(root);
let tunnel:ChildProcess|undefined,backend:ChildProcess|undefined;
function loadAccount():string|RemoteAccount{
 try{return validateRemoteAccount(JSON.parse(readFileSync(join(root,'data','remote-account.json'),'utf8')));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return randomBytes(18).toString('base64url');throw error;}
}
const password=loadAccount();
const loginDescription=typeof password==='string'?`用户名：viewer\n临时密码：${password}`:`用户名：${password.username}\n密码：使用已设置的固定密码（不在窗口或文件中显示）`;
const gateway=createRemoteGateway(password);
let stopping=false;
function stop(){if(stopping)return;stopping=true;tunnel?.kill();gateway.server.close();gateway.server.closeAllConnections();backend?.kill();setTimeout(()=>process.exit(),300).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function main(){
 console.log('月下议会 · 平板远程展示\n本程序不会自动开始游戏。电脑必须保持开机联网，关闭窗口会中断本次远程展示。');
 const binary=await installTunnel();
 const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:root,stdio:'inherit',windowsHide:true});
 if(build.status!==0)throw Error('网页构建失败，请检查依赖');
 let ready=false;
 try{const r=await fetch('http://localhost:3000/api/rules',{signal:AbortSignal.timeout(3000)});const data=await r.json();ready=r.ok&&Array.isArray(data.roles)&&data.roles.length===12;}catch{}
 if(!ready){
  backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,stdio:'inherit',windowsHide:true});
  backend.once('error',e=>{console.error(e.message);stop();});
  backend.once('exit',()=>{if(!stopping){console.error('本地服务退出，远程入口关闭');stop();}});
  for(let n=0;n<30&&!ready;n++){await new Promise(r=>setTimeout(r,500));try{const r=await fetch('http://localhost:3000/api/rules',{signal:AbortSignal.timeout(1000)});ready=r.ok;}catch{}}
 }
 if(!ready)throw Error('本地服务未就绪；请检查3000端口是否被其他程序占用');
 await new Promise<void>((resolve,reject)=>{gateway.server.once('error',reject);gateway.server.listen(3001,'127.0.0.1',resolve);});
 console.log('正在建立加密隧道……不会修改路由器或开放防火墙入站端口。');
 tunnel=spawn(binary,['tunnel','--no-autoupdate','--url','http://127.0.0.1:3001','--protocol','http2'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let buffer='',published=false;
 const output=(chunk:Buffer)=>{
  const text=chunk.toString();buffer=(buffer+text).slice(-16000);
  const url=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if(url&&!published){published=true;gateway.setPublicOrigin(url);
   const instructions=`月下议会 · 本次远程展示\n\n平板网址：${url}\n${loginDescription}\n\n电脑与平板无需同一Wi-Fi。平板浏览器打开网址，在登录弹窗输入账号密码。\n保持电脑开机联网，不要休眠或关闭启动窗口。\n网址每次重启变化；已配置的固定账号密码保持不变，未配置时使用临时密码。隧道需几秒钟连接；此文件只代表最近一次启动，不保证入口仍在线。\n可看历史、全知回放，每次启动最多远程开3局且同时1局。\n新开局会调用已有模型并可能计费，3局限制不是费用预算；模型设置仅能在电脑修改。\n关闭启动窗口会停止隧道，并停止本启动器创建的后台；既有独立后台不会被终止。\n勿公开分享登录凭据。\n`;
   console.log(instructions);
   void mkdir(join(root,'data'),{recursive:true}).then(()=>writeFile(join(root,'data','平板登录信息.txt'),instructions,'utf8'));
  }
  // Cloudflare diagnostic text contains no application API key or login password.
  if(/ERR|failed|Registered tunnel connection/i.test(text))console.log(text.trim());
 };
 tunnel.stdout?.on('data',output);tunnel.stderr?.on('data',output);
 tunnel.once('error',e=>{console.error(e.message);stop();});
 tunnel.once('exit',()=>{if(!stopping){console.error('隧道已退出，远程网址不可用。');stop();}});
 setTimeout(()=>{if(!published&&!stopping){console.error('60秒内未取得隧道地址，请检查网络。');stop();}},60000).unref();
}
main().catch(e=>{console.error('启动失败：',e.message,e.cause?.code??'');process.exitCode=1;stop();});
