export function applyGameEvent(game: any, event: {type:string;phase:string;payload:any}) {
  const p=event.payload;
  if(event.type==='公开状态') return {...game,...p,players:game.players.map((player:any)=>({...player,...p.players.find((x:any)=>x.seat===player.seat)}))};
  const next={...game,phase:event.phase,players:game.players.map((p:any)=>({...p}))};
  if(event.type==='警长') next.sheriff=p.seat;
  if(event.type==='警徽移交') next.sheriff=p.to;
  if(event.type==='撕毁警徽') next.sheriff=undefined;
  const deaths=event.type==='天亮公告'?p.seats:event.type==='猎人开枪'?[p.target]:event.type==='投票'&&p.target?[p.target]:[];
  for(const seat of deaths??[]) {const player=next.players.find((x:any)=>x.seat===seat);if(player)player.alive=false;}
  if(event.type==='结局公告') {next.status='finished';next.winner=p.winner;next.phase='游戏结束';}
  if(event.type==='状态') next.status=p.status;
  if(event.type==='错误') next.status='error';
  return next;
}
