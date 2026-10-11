import {it,expect} from 'vitest';
import {scryptSync} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createRemoteGateway,remoteAuthenticated,remoteRouteAllowed} from '../server/remote-gateway.js';
const password='test-remote-password-123456789';
const authorization='Basic '+Buffer.from(`viewer:${password}`).toString('base64');
it('固定账号使用加盐校验值，重建网关后仍有效且拒绝旧账号与错误密码',async()=>{
 const salt='0123456789abcdef0123456789abcdef',account={username:'demo-user',salt,passwordHash:scryptSync('example8',salt,64).toString('hex')};
 const auth=(user:string,pass:string)=>'Basic '+Buffer.from(`${user}:${pass}`).toString('base64');
 for(let n=0;n<2;n++){
  const gateway=createRemoteGateway(account),url=await listen(gateway.server);gateway.setPublicOrigin(url);
  try{
   expect((await fetch(url+'/api/remote-session',{headers:{authorization:auth('demo-user','example8')}})).status).toBe(200);
   expect((await fetch(url+'/api/remote-session',{headers:{authorization:auth('demo-user','wrong')}})).status).toBe(401);
   expect((await fetch(url+'/api/remote-session',{headers:{authorization}})).status).toBe(401);
  }finally{await close(gateway.server);}
 }
 expect(()=>createRemoteGateway({...account,passwordHash:'bad'})).toThrow();
});
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
it('鉴权拒绝空凭据、短密码及错误用户；路由采用白名单',()=>{
 expect(remoteAuthenticated(authorization,password)).toBe(true);
 expect(remoteAuthenticated(undefined,password)).toBe(false);
 expect(remoteAuthenticated(authorization,'short')).toBe(false);
 expect(remoteAuthenticated('Basic '+Buffer.from('admin:'+password).toString('base64'),password)).toBe(false);
 for(const path of ['/api/settings','/api/agent-model-profiles','/api/models/test','/api/simulations','/data/werewolf.sqlite']){
  expect(remoteRouteAllowed('GET',path)).toBe(false);expect(remoteRouteAllowed('POST',path)).toBe(false);
 }
 expect(remoteRouteAllowed('GET','/api/games')).toBe(true);
});
it('登录前不能读取游戏，配置与跨站操作不可访问，HTML启用远程刷新',async()=>{
 let hits=0;
 const upstream=createServer((_req,res)=>{hits++;res.setHeader('Content-Type','text/html');res.end('<head></head><body>demo</body>');});
 const local=await listen(upstream),gateway=createRemoteGateway(password,local),url=await listen(gateway.server);gateway.setPublicOrigin(url);
 try{
  expect((await fetch(url)).status).toBe(401);expect(hits).toBe(0);
  expect((await fetch(url+'/api/settings',{headers:{authorization}})).status).toBe(403);expect(hits).toBe(0);
  expect((await fetch(url+'/api/games',{method:'POST',headers:{authorization,Origin:'https://evil.example','X-Remote-Action':'1'}})).status).toBe(403);
  expect((await fetch(url+'/api/games',{method:'POST',headers:{authorization,Origin:url}})).status).toBe(403);
  const page=await fetch(url,{headers:{authorization}});expect(await page.text()).toContain('/remote-mode.js');
  expect(page.headers.get('cache-control')).toBe('no-store');expect(page.headers.get('x-frame-options')).toBe('DENY');
 }finally{await close(gateway.server);await close(upstream);}
});
it('远程开局串行且最多3次，认证信息不转发到后端',async()=>{
 let calls=0,status='running',leaked=false;
 const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const upstream=createServer((req,res)=>{
  leaked ||= Boolean(req.headers.authorization||req.headers.origin||req.headers['cf-connecting-ip']);
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'&&req.url==='/api/games'){calls++;res.statusCode=201;res.end(JSON.stringify({id:id(calls)}));}
  else res.end(JSON.stringify({status}));
 });
 const gateway=createRemoteGateway(password,await listen(upstream)),url=await listen(gateway.server);gateway.setPublicOrigin(url);
 const start=()=>fetch(url+'/api/games',{method:'POST',headers:{authorization,Origin:url,'X-Remote-Action':'1'}});
 try{
  const responses=await Promise.all([start(),start()]);expect(responses.filter(r=>r.status===201)).toHaveLength(1);expect(calls).toBe(1);
  expect((await start()).status).toBe(409);
  status='finished';expect((await start()).status).toBe(201);expect((await start()).status).toBe(201);
  expect((await start()).status).toBe(429);expect(calls).toBe(3);expect(leaked).toBe(false);
 }finally{await close(gateway.server);await close(upstream);}
});
it('开局响应不明确时锁住后续开局，避免因重试重复付费',async()=>{
 let calls=0;
 const upstream=createServer((_req,res)=>{calls++;res.writeHead(500);res.end('error');});
 const gateway=createRemoteGateway(password,await listen(upstream)),url=await listen(gateway.server);gateway.setPublicOrigin(url);
 const start=()=>fetch(url+'/api/games',{method:'POST',headers:{authorization,Origin:url,'X-Remote-Action':'1'}});
 try{expect((await start()).status).toBe(500);expect((await start()).status).toBe(409);expect(calls).toBe(1);}
 finally{await close(gateway.server);await close(upstream);}
});
