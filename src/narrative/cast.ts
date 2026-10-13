/**
 * Cast identity (design §5.5, §6). A worker is named after its agent; a second
 * session running the same agent in one episode gets a suffix; an unknown agent
 * is "unidentified", never a guess.
 */

export type CastID = string

type Session = { id: string; agent?: string; parentID?: string }

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

export function rootFor(sessionID: string, sessions: Map<string, Session>): string {
  const visited = new Set<string>()
  let root = sessionID
  while (sessions.get(root)?.parentID) {
    if (visited.has(root)) return sessionID // malformed snapshot: never loop on a parent cycle
    visited.add(root)
    root = sessions.get(root)!.parentID!
  }
  return root
}

/** Suffixes belong to a chat, not to unrelated sessions elsewhere on the floor. */
export function castByRoot(sessions: Session[]): (sessionID: string) => CastID {
  const index = new Map(sessions.map(s => [s.id, s]))
  const groups = new Map<string, Session[]>()
  for (const session of sessions) {
    const root = rootFor(session.id, index)
    const group = groups.get(root) ?? []
    group.push(session)
    groups.set(root, group)
  }
  const casts = new Map([...groups].map(([root, group]) => [root, castFor(group)]))
  return sessionID => casts.get(rootFor(sessionID, index))?.(sessionID) ?? 'unidentified'
}
