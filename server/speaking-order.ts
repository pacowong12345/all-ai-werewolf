export type Direction='left'|'right';
// Fixed table convention: left is decreasing seat number, right increasing.
export function speakingOrder(alive:number[],anchor:number,direction:Direction,sheriff?:number,first=false) {
 const step=direction==='left'?-1:1;
 const ring=Array.from({length:12},(_,i)=>((anchor-1+step*(i+1))%12+12)%12+1);
 const others=ring.filter(s=>alive.includes(s)&&s!==sheriff);
 return sheriff&&alive.includes(sheriff)?first?[sheriff,...others]:[...others,sheriff]:others;
}
export function automaticOrder(alive:number[],dead:number[],dawnTime:string) {
 const minute=new Date(dawnTime).getUTCMinutes();
 if(!Number.isFinite(minute))throw new Error('天亮公告时间无效，不能决定发言顺序');
 const direction:Direction=minute%2?'left':'right';
 const anchor=dead.length?Math.min(...dead):1;
 let order=speakingOrder(alive,anchor,direction);
 if(!dead.length&&alive.includes(1))order=[1,...order.filter(s=>s!==1)];
 return {minute,direction,anchor,order};
}
export const mayGiveLastWords=(day:number,cause:string)=>cause==='放逐'||(day===1&&['狼人袭击','同守同救'].includes(cause));
