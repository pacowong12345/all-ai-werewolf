import {it,expect} from 'vitest';
import {recapRounds,renderRecap,type RecapEvent} from '../client/recap.js';
const events:RecapEvent[]=[
 {id:1,type:'狼人密聊',phase:'第2夜',visibility:'wolves',payload:{text:'1号提议9号：秘密\n最终夜袭 9 号。'}},
 {id:2,type:'守卫行动',phase:'第2夜',visibility:'private',payload:{seat:5,target:9}},
 {id:3,type:'验人',phase:'第2夜',visibility:'private',payload:{seat:8,target:1,result:'狼人'}},
 {id:4,type:'天亮公告',phase:'第2夜',visibility:'public',payload:{seats:[],text:'昨夜平安夜。'}},
 {id:5,type:'投票',phase:'第2日讨论',visibility:'public',payload:{votes:[{seat:1,target:3,weight:1},{seat:2,target:3,weight:1.5},{seat:3,target:1,weight:1}],result:'3号被放逐。'}},
];
it('旧局刀口与死亡结果区分，按昼夜合并并正确计算警长票重',()=>{
 expect(recapRounds(events,true)).toHaveLength(1);
 const html=renderRecap(events,true);expect(html).toContain('狼人刀口');expect(html).toContain('9号');expect(html).toContain('昨夜平安夜');expect(html).toContain('2.5票');expect(html).toContain('2号 ★');expect(html).toContain('3号被放逐');
});
it('即使传入全知事件，无剧透回放也不渲染秘密行动',()=>{
 const html=renderRecap(events,false);expect(html).not.toContain('狼人刀口');expect(html).not.toContain('守卫 5号');expect(html).not.toContain('预言家 8号');expect(html).not.toContain('9号');expect(html).toContain('昨夜平安夜');expect(html).toContain('2.5票');
});
it('不将未记录技能编造成未使用，回合筛选和新格式正常',()=>{
 const newer:RecapEvent={id:6,type:'狼人密聊',phase:'第3夜',visibility:'wolves',payload:{target:7,messages:[]}};
 const html=renderRecap([...events,newer],true,'3');expect(html).toContain('7号');expect(html).not.toContain('2.5票');expect(html).toContain('尚无投票');expect(html).not.toContain('平安夜');
});
