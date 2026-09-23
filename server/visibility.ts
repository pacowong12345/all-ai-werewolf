import type { EventRecord, Player } from './types.js';

export function visibleToPlayer(event: EventRecord, player: Player, gameId: string) {
  if (event.gameId !== gameId) return false;
  if (event.visibility === 'public') return true;
  if (event.visibility === 'private') return event.audience?.includes(player.seat) === true;
  if (event.visibility === 'wolves') return player.role === '狼人' && event.audience?.includes(player.seat) === true;
  return false;
}
