import {createServer, type IncomingMessage} from 'node:http';
import {timingSafeEqual,scryptSync} from 'node:crypto';

export interface RemoteAccount {username:string;salt:string;passwordHash:string}
export function validateRemoteAccount(account:RemoteAccount){
 if(!account||typeof account.username!=='string'||!account.username.trim()||account.username.length>128||/[:\r\n]/.test(account.username)||!/^[a-f0-9]{32}$/.test(account.salt)||!/^[a-f0-9]{128}$/.test(account.passwordHash))throw Error('本地远程账号配置无效');
 return account;
}

const uuid='[a-f0-9-]{36}';
export function remoteRouteAllowed(method:string,path:string) {
 if(method==='GET')return path==='/'||path==='/remote-mode.js'||path==='/api/remote-session'||
  /^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path)||
  ['/api/rules','/api/games','/api/world','/api/learning'].includes(path)||
  new RegExp(`^/api/games/${uuid}(/events)?$`).test(path)||
  /^\/api\/world\/agents\/agent-\d{2}$/.test(path);
 return method==='POST'&&(path==='/api/games'||new RegExp(`^/api/games/${uuid}/control$`).test(path));
}
export function remoteAuthenticated(header:string|undefined,password:string|RemoteAccount) {
 if(!header?.startsWith('Basic ')||header.length>2048)return false;
 if(typeof password!=='string'){
  const decoded=Buffer.from(header.slice(6),'base64').toString('utf8'),colon=decoded.indexOf(':');
  if(colon<0||decoded.slice(0,colon)!==password.username)return false;
  const got=scryptSync(decoded.slice(colon+1),password.salt,64),wanted=Buffer.from(password.passwordHash,'hex');
  return wanted.length===got.length&&timingSafeEqual(got,wanted);
 }
 if(password.length<24)return false;
 const got=Buffer.from(header.slice(6),'base64'),wanted=Buffer.from(`viewer:${password}`);
 return got.length===wanted.length&&timingSafeEqual(got,wanted);
}
async function readBody(req:IncomingMessage) {
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>4096)throw Error('请求过大');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString()||'{}') as Record<string,unknown>;
}

/** Separate loopback-only gateway: never forward credentials or arbitrary URLs. */
export function createRemoteGateway(password:string|RemoteAccount,upstream='http://127.0.0.1:3000') {
 if(typeof password==='string'){if(password.length<24)throw Error('远程密码过短');}else validateRemoteAccount(password);
 const local=new URL(upstream);
 if(local.hostname!=='127.0.0.1'||local.protocol!=='http:')throw Error('上游必须是本机服务');
 let publicOrigin='',busy=false,uncertainStart=false,starts=0,windowStart=Date.now(),failures=0,writes=0;
 const created=new Set<string>();
 const server=createServer(async(req,res)=>{
  const send=(status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error}));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(!publicOrigin){send(503,'远程入口准备中');return;}
  if(req.headers.host!==new URL(publicOrigin).host){send(403,'访问地址不匹配');return;}
  if(Date.now()-windowStart>60000){windowStart=Date.now();failures=0;writes=0;}
  if(failures>=30){send(429,'登录失败次数过多，请一分钟后重试');return;}
  if(!remoteAuthenticated(req.headers.authorization,password)){
   if(++failures>30){send(429,'登录失败次数过多，请一分钟后重试');return;}
   res.setHeader('WWW-Authenticate','Basic realm="Moon Council"');send(401,'请输入远程展示账号和密码');return;
  }
  const raw=req.url??'/';
  if(raw.includes('%')||raw.includes('\\')||raw.includes('..')||raw.startsWith('//')){send(400,'无效路径');return;}
  const url=new URL(raw,publicOrigin),method=req.method??'GET';
  if(!remoteRouteAllowed(method,url.pathname)){send(403,'远程展示不开放模型配置、密钥、导出、批量模拟或其他管理功能');return;}
  if(req.headers.origin&&req.headers.origin!==publicOrigin){send(403,'拒绝跨站请求');return;}
  if(method==='POST'&&(req.headers.origin!==publicOrigin||req.headers['x-remote-action']!=='1')){send(403,'请从已登录的展示页面操作');return;}
  if(method==='POST'&&++writes>20){send(429,'操作过于频繁，请稍后再试');return;}
  if(url.pathname==='/remote-mode.js'){res.setHeader('Content-Type','application/javascript');res.end('window.__REMOTE_DEMO__=true;');return;}
  if(url.pathname==='/api/remote-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({remainingStarts:3-starts,maxStarts:3}));return;}
  let locked=false;
  try {
   let body:Record<string,unknown>|undefined;
   if(method==='POST'){
    body=await readBody(req);
    if(url.pathname==='/api/games'){
     if(uncertainStart){send(409,'上次开局响应不确定，请在电脑核实，不要重复开局');return;}
     if(busy||starts>=3){send(429,'每次启动最多远程提交3次开局，且同时只能开一局；这不是费用预算上限');return;}
     busy=true;locked=true;
     for(const id of created){
      const state=await fetch(`${upstream}/api/games/${id}`,{signal:AbortSignal.timeout(5000)});
      if(!state.ok)throw Error('无法确认上局状态');
      if((await state.json() as {status:string}).status!=='finished'){send(409,'请先完成本次远程已开启的对局，暂停或报错也算未完成');return;}
     }
     body={};
    }else{
     const id=url.pathname.split('/')[3];
     if(!created.has(id)){send(403,'只能控制本次远程入口开启的对局，历史局仅供回放');return;}
     if(!['play','pause','step','speed'].includes(String(body.action))){send(400,'无效操作');return;}
     body={action:body.action,...(body.action==='speed'?{speed:Math.max(.25,Math.min(5,Number(body.speed)||1))}:{})};
    }
   }
   if(method==='POST'&&url.pathname==='/api/games'){starts++;uncertainStart=true;}
   const response=await fetch(`${upstream}${url.pathname}${url.search}`,{
    method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined
   });
   let data=Buffer.from(await response.arrayBuffer());
   if(method==='POST'&&url.pathname==='/api/games'&&response.status===201){
    const result=JSON.parse(data.toString());if(typeof result.id!=='string')throw Error('缺少局号');created.add(result.id);uncertainStart=false;
   }
   const contentType=response.headers.get('content-type')??'application/octet-stream';
   if(url.pathname==='/'&&response.ok){data=Buffer.from(data.toString().replace('<head>','<head><script src="/remote-mode.js"></script>'));}
   res.writeHead(response.status,{'Content-Type':contentType});res.end(data);
  }catch{if(!res.headersSent)send(502,'本机服务无法响应，请检查电脑启动窗口；不要连续重复开局');else res.end();}
  finally{if(locked)busy=false;}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 return {server,setPublicOrigin(origin:string){const u=new URL(origin);if(u.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u.hostname))throw Error('远程入口必须HTTPS');publicOrigin=u.origin;}};
}
