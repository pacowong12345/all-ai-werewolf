import type {EventRecord,Player} from './types.js';
import {visibleToPlayer} from './visibility.js';
// Never derive public knowledge from the secret roster. Keep original sources.
export function evidenceLedger(events:EventRecord[],player:Player,gameId:string) {
 const visible=events.filter(e=>visibleToPlayer(e,player,gameId));
 const facts=visible.filter(e=>['投票','警长投票','天亮公告','警长','警徽移交','撕毁警徽','猎人开枪','验人','守卫行动','女巫用药'].includes(e.type))
  .map(e=>({eventId:e.id,phase:e.phase,type:e.type,scope:e.visibility,payload:e.payload}));
 const claims=visible.filter(e=>['发言','遗言','质询','答辩'].includes(e.type))
  .map(e=>({eventId:e.id,phase:e.phase,seat:e.payload.seat,text:e.payload.text,status:'玩家主张，未经主持人核实'}));
 return {notice:'本局出局不翻牌，警徽移交不等于查验。银水不是验明好人。票型必须核对阶段与事件编号，不能用复述替代原始记录。发言中的身份、查杀、用药声明均不是公开认证，但未公开认证不等于虚假：预言家的真查验也只发给本人，不应要求对方提供不存在的公开查验凭证。村民身份与被验出好人并不矛盾。上警者不投警长票是规则，不是缺乏参与的嫌疑证据。',facts,claims};
}
