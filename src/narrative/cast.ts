/**
 * Cast identity (design §5.5, §6). A worker is named after its agent; a second
 * session running the same agent in one episode gets a suffix; an unknown agent
 * is "unidentified", never a guess.
 */

export type CastID = string

type Session = { id: string; agent?: string }

export function castFor(sessions: Session[]): (sessionID: string) => CastID {
  const byAgent = new Map<string, string[]>()
  for (const s of sessions) {
    if (s.agent === undefined) continue
    const list = byAgent.get(s.agent) ?? []
    list.push(s.id)
    byAgent.set(s.agent, list)
  }

  const map = new Map<string, CastID>()
  for (const [agent, ids] of byAgent) {
    for (let i = 0; i < ids.length; i++) {
      map.set(ids[i], i === 0 ? agent : `${agent}·${i + 1}`)
    }
  }

  return (sessionID: string) => map.get(sessionID) ?? 'unidentified'
}
