export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]!));

export function renderWolfChat(payload: Record<string, unknown>): string {
  // Read old immutable logs without rewriting history.
  const legacy = typeof payload.text === 'string' ? payload.text : '';
  const messages = Array.isArray(payload.messages) ? payload.messages : [...legacy.matchAll(/(?:^|\n)(\d+)号提议(\d+)号[：:]([\s\S]*?)(?=\n\d+号提议\d+号[：:]|\n最终夜袭|$)/g)].map(match => ({seat:Number(match[1]),target:Number(match[2]),text:match[3]}));
  const target = payload.target ?? legacy.match(/最终夜袭\s*(\d+)\s*号/)?.[1];
  if(payload.round && !target) return `<span class="wolf-chat">第 ${escapeHtml(payload.round)} 轮竞选协商${messages.map(m=>`<span class="wolf-message"><b>${escapeHtml(m.seat)}号</b><span class="wolf-body">${escapeHtml(m.text)}</span></span>`).join('')}</span>`;
  return `<span class="wolf-chat">${messages.length ? messages.map(message => `<span class="wolf-message"><span class="wolf-speaker">${escapeHtml(message.seat)}号${message.name ? ` · ${escapeHtml(message.name)}` : ''}<span class="wolf-target">提议袭击 ${escapeHtml(message.target)} 号</span></span><span class="wolf-body">${escapeHtml(message.text)}</span></span>`).join('') : `<span class="wolf-body">${escapeHtml(legacy || '没有夜聊发言记录')}</span>`}${target ? `<span class="wolf-result">最终夜袭：${escapeHtml(target)} 号 · ${escapeHtml(payload.resolution??'')}</span>` : ''}</span>`;
}
