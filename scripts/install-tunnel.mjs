import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
export async function installTunnel(){
 const dir=join(root,'data','tools');await mkdir(dir,{recursive:true});
 const exe=join(dir,'cloudflared.exe'),record=join(dir,'cloudflared.json');
 try{const saved=JSON.parse(await readFile(record,'utf8'));const bytes=await readFile(exe);
  if(createHash('sha256').update(bytes).digest('hex')===saved.sha256)return exe;
 }catch{}
 console.log('首次安装：从 Cloudflare 官方 GitHub 发布下载隧道工具，并验证 SHA-256。');
 const release=await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',{headers:{'User-Agent':'moon-council-local-demo'},signal:AbortSignal.timeout(30000)});
 if(!release.ok)throw Error(`无法读取官方版本：${release.status}`);
 const metadata=await release.json();
 const asset=metadata.assets.find(a=>a.name==='cloudflared-windows-amd64.exe');
 if(!asset?.digest?.match(/^sha256:[a-f0-9]{64}$/))throw Error('官方发布缺少校验值，拒绝下载未经核验的程序');
 if(!asset.browser_download_url.startsWith('https://github.com/cloudflare/cloudflared/releases/download/'))throw Error('下载来源不匹配');
 const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw Error(`下载失败：${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex');
 if(`sha256:${sha256}`!==asset.digest)throw Error('校验失败，拒绝运行');
 await writeFile(exe+'.download',bytes);await rename(exe+'.download',exe);
 await writeFile(record,JSON.stringify({version:metadata.tag_name,sha256},null,2));
 return exe;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])installTunnel().then(()=>console.log('隧道工具就绪')).catch(e=>{console.error('隧道工具安装失败：',e.message,e.cause?.code??'');process.exitCode=1;});
