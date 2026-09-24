import {it,expect} from 'vitest';
import {automaticOrder,speakingOrder,mayGiveLastWords} from '../server/speaking-order.js';
it('警长左右末置或抢先，环形跳过死者且不重复',()=>{
 const alive=[1,3,5,8,12];
 expect(speakingOrder(alive,5,'right',5)).toEqual([8,12,1,3,5]);
 expect(speakingOrder(alive,5,'left',5)).toEqual([3,1,12,8,5]);
 expect(speakingOrder(alive,5,'left',5,true)).toEqual([5,3,1,12,8]);
});
it('固定天亮分钟单双数，多死取最小座位，平安夜从1号或下一存活者开始',()=>{
 expect(automaticOrder([1,3,5,8,12],[4,9],'2026-09-25T00:01:00Z').order).toEqual([3,1,12,8,5]);
 expect(automaticOrder([1,3,5,8,12],[4,9],'2026-09-25T00:02:00Z').order).toEqual([5,8,12,1,3]);
 expect(automaticOrder([1,3,5],[],'2026-09-25T00:01:00Z').order).toEqual([1,5,3]);
 expect(automaticOrder([3,5],[],'2026-09-25T00:01:00Z').order).toEqual([5,3]);
});
it('只有首夜狼刀及放逐有遗言',()=>{
 expect(mayGiveLastWords(1,'狼人袭击')).toBe(true);expect(mayGiveLastWords(1,'同守同救')).toBe(true);
 for(const day of [1,2,3]){expect(mayGiveLastWords(day,'女巫毒杀')).toBe(false);expect(mayGiveLastWords(day,'猎人开枪')).toBe(false);expect(mayGiveLastWords(day,'放逐')).toBe(true);}
 expect(mayGiveLastWords(2,'狼人袭击')).toBe(false);
});
