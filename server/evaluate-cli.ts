import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LocalStore} from './store.js';
import {evaluatePair} from './evaluation.js';
import {summarizeExperience} from './learning.js';
import {PERSONAS} from './personas.js';
const live=process.argv.includes('--live');
if(live&&!process.argv.includes('--confirm-paid'))throw Error('真实对照会执行6次模型请求，可能计费；请明确提供 --confirm-paid 与 --agent=人物ID。');
const id=process.argv.find(x=>x.startsWith('--agent='))?.slice(8);
let store:LocalStore|undefined;
try{
 if(live&&!id)throw Error('必须选择人物 --agent=agent-01');
 store=live?new LocalStore():undefined;
 const profile=id?store?.agentProfile(id):undefined;
 if(live&&(!profile?.enabled||profile.provider==='mock'))throw Error('所选人物没有启用的在线模型档案');
 const agent=id?store?.worldAgent(id):undefined;
 const memory=id?store?.experiences(id).filter(x=>x.role!=='狼人').slice(0,3).map(summarizeExperience).join('\n')??'':'';
 const report=await evaluatePair(profile??{provider:'mock',model:'offline-demo'},{seat:1,role:'村民',slot:'村民1',alive:true,belief:{},persona:agent?.persona??PERSONAS[0]},memory);
 const dir=join(process.cwd(),'data','evaluations');mkdirSync(dir,{recursive:true});const path=join(dir,`${Date.now()}-${live?'live':'offline'}.json`);writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,path},null,2));
}finally{store?.close();}
