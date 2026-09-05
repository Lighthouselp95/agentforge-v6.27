export function resolveTeamIdForMsg(msg: any, getAgent?: (id: string) => any): string {
  if (msg && msg.teamId && typeof msg.teamId === 'string') return msg.teamId;
  const candidates = [msg && msg.from, msg && msg.to];
  for (const cid of candidates) {
    if (!cid || typeof cid !== 'string' || cid === 'user' || cid === 'broadcast') continue;
    if (getAgent) {
      const ag = getAgent(cid);
      if (ag && ag.teamId && typeof ag.teamId === 'string') return ag.teamId;
    }
  }
  return 'default';
}
