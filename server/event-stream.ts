import type {EventRecord} from './types.js';

export function eventCursor(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
export function eventFrame(event: EventRecord, mode: 'public' | 'omniscient'): string {
  if (mode === 'public' && event.visibility !== 'public') return '';
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
