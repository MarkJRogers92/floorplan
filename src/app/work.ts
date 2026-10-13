/** Work admission is separate from storytelling: only the engine's real frames narrate. */
import type { createWorkClient, WorkAgent, WorkMessage, WorkPermission, WorkProject, WorkSession } from './work-client'
import type { Frame } from '../api/sse'
import { rootFor } from '../narrative/cast'
import { isID, isRecord } from '../narrative/evidence'

export type WorkState = {
  projects: WorkProject[]; agents: WorkAgent[]; sessions: WorkSession[]
  directory: string; agent: string; selectedID: string; messages: WorkMessage[]
  permissions: WorkPermission[]; otherRequests: number; questions: { id: string; sessionID: string; title: string }[]
  busy: boolean; replay: boolean; notice: string
}

export function createWorkRuntime(client: ReturnType<typeof createWorkClient>, changed = () => {}, created = (_session: WorkSession) => {}) {
  const state: WorkState = { projects: [], agents: [], sessions: [], directory: '', agent: '', selectedID: '', messages: [],
    permissions: [], otherRequests: 0, questions: [], busy: false, replay: false, notice: 'Choose a project and agent, then give them a job.' }
  const pending = new Map<string, { text: string; id: string }>()
  const problems = new Set<string>()
  let epoch = 0, catalog = 0, reads = 0
  const belongs = (id: string) => !!state.selectedID && rootFor(id, new Map(state.sessions.map(s => [s.id, s]))) === state.selectedID
  const remember = (session: WorkSession) => {
    state.sessions = [...state.sessions.filter(s => s.id !== session.id), session]
  }
  const writable = () => !state.busy && !state.replay
  const refresh = async () => {
    if (state.replay || !state.selectedID) return
    const token = epoch, sequence = ++reads, id = state.selectedID
    const current = () => token === epoch && sequence === reads && !state.replay && id === state.selectedID
    const recovered = (part: string) => {
      if (problems.delete(part) && state.notice.includes('unavailable. Work may still be running.')) {
        state.notice = problems.size ? [...problems].join(' and ') + ' unavailable. Work may still be running.' : `${part} available again.`
      }
    }
    const unavailable = (part: string) => {
      if (!current()) return
      problems.add(part); state.notice = [...problems].join(' and ') + ' unavailable. Work may still be running.'; changed()
    }
    await Promise.all([
      client.messages(id).then(messages => { if (current()) { state.messages = messages; recovered('Conversation'); changed() } }, () => unavailable('Conversation')),
      client.permissions(state.directory).then(permissions => {
        if (!current()) return
        state.permissions = permissions.filter(p => belongs(p.sessionID))
        state.otherRequests = permissions.length - state.permissions.length; recovered('Permissions'); changed()
      }, () => {
        if (current()) { state.permissions = []; state.otherRequests = 0 }
        unavailable('Permissions')
      }),
    ])
  }
  const select = async (id: string) => {
    if (!writable() || (id && !state.sessions.some(s => s.id === id && !s.parentID))) return
    const token = ++epoch
    problems.clear()
    state.selectedID = id; state.messages = []; state.permissions = []; state.otherRequests = 0; state.agents = []
    if (!id) {
      state.agent = ''; state.agents = []; state.notice = 'Choose a project and agent for a new job.'; changed()
      if (state.directory) await setDirectory(state.directory)
      return
    }
    state.busy = true; state.notice = 'Loading the selected job…'; changed()
    try {
      const found = await client.session(id)
      if (token !== epoch || state.replay) return
      if (found.parentID) throw new Error('not a root job')
      remember(found)
      state.directory = found.directory; state.agent = found.agent ?? ''
      state.notice = 'Follow-up messages go to this job in its stored project.'
    } catch {
      if (token !== epoch) return
      state.selectedID = ''; state.notice = 'Could not verify this job. No work was submitted.'
    } finally {
      if (token === epoch) { state.busy = false; changed() }
    }
    if (token === epoch) void refresh()
  }
  const setDirectory = async (directory: string) => {
    if (!writable() || state.selectedID) return
    const version = ++catalog
    state.directory = directory; state.agents = []; state.agent = ''
    state.notice = 'Loading configured agents for this project…'; changed()
    try {
      const agents = await client.agents(state.directory)
      if (version !== catalog || state.replay || state.selectedID) return
      state.agents = agents
      state.notice = agents.length ? 'Choose an agent and enter your prompt.' : 'No visible primary agents returned. Try Load / refresh agents; this project’s configuration may still be loading.'
    } catch {
      if (version !== catalog || state.replay || state.selectedID) return
      state.notice = 'Enter an existing absolute project directory, then try loading its agents again.'
    }
    changed()
  }
  const submit = async (text: string): Promise<boolean> => {
    if (!writable()) return false
    if (!text.trim() || text.length > 16_000 || (!state.selectedID && (!state.directory || !state.agents.some(a => a.id === state.agent)))) {
      state.notice = 'Choose a project and listed agent, and enter a prompt (up to 16,000 characters).'; changed(); return false
    }
    const token = epoch
    state.busy = true; state.notice = 'Submitting to OpenCode…'; changed()
    let id = state.selectedID
    try {
      if (!id) {
        const session = await client.create(state.directory, state.agent, text.replace(/\s+/g, ' ').slice(0, 80))
        if (token !== epoch || state.replay) return false
        remember(session); state.selectedID = id = session.id
        state.directory = session.directory; state.agent = session.agent ?? state.agent
        created(session); changed()
      }
      const previous = pending.get(id)
      const input = previous?.text === text ? previous : { text, id: `msg_${crypto.randomUUID().replaceAll('-', '')}` }
      pending.set(id, input)
      await client.prompt(id, text, input.id)
      if (pending.get(id) === input) pending.delete(id)
      if (token !== epoch || state.replay) return false
      state.notice = 'Prompt accepted by OpenCode. Watch the job below; this is not a completion claim.'
      void refresh()
      return true
    } catch {
      if (token === epoch) state.notice = id ? 'The prompt may have reached OpenCode. Check the real conversation before retrying.' :
        'Could not confirm the new job. OpenCode may have created a session; check before starting another. No prompt was sent by this page.'
      return false
    } finally {
      if (token === epoch) { state.busy = false; changed() }
    }
  }
  const stop = async (): Promise<boolean> => {
    if (!writable() || !state.selectedID) return false
    const token = epoch, id = state.selectedID
    state.busy = true; changed()
    try {
      const interrupted = await client.stop(id)
      if (token !== epoch) return false
      state.notice = interrupted ? 'Interruption requested for this session.' : 'This session is already idle.'
      return true
    } catch { if (token === epoch) state.notice = 'Could not confirm interruption. Work may still be running.'; return false }
    finally { if (token === epoch) { state.busy = false; changed() } }
  }
  const reply = async (sessionID: string, requestID: string, decision: 'once' | 'reject'): Promise<boolean> => {
    if (!writable() || (decision !== 'once' && decision !== 'reject') ||
      !state.permissions.some(p => p.sessionID === sessionID && p.id === requestID) || !belongs(sessionID)) return false
    const token = epoch
    state.busy = true; changed()
    try {
      await client.reply(sessionID, requestID, decision)
      if (token !== epoch) return false
      state.notice = 'Permission reply sent. Waiting for OpenCode.'
      void refresh()
      return true
    } catch { if (token === epoch) state.notice = 'Could not confirm the permission reply. Refresh before trying again.'; return false }
    finally { if (token === epoch) { state.busy = false; changed() } }
  }
  const setQuestions = (rows: unknown[]) => {
    if (state.replay) return
    state.questions = rows.flatMap(row => isRecord(row) && isID(row.id) && isID(row.sessionID) ?
      [{ id: row.id, sessionID: row.sessionID, title: typeof row.title === 'string' ? row.title : 'Agent question' }] : [])
    changed()
  }
  const push = (frame: Frame) => {
    if (state.replay || !isRecord(frame.data)) return
    const data = frame.data
    const type = frame.type.startsWith('session.') ? frame.type.slice(8) : frame.type
    const id = typeof data.sessionID === 'string' ? data.sessionID : ''
    if (type === 'created' && id) {
      const location = isRecord(frame.location) ? frame.location.directory : undefined
      const known = state.sessions.find(s => s.id === id)
      const directory = typeof location === 'string' ? location : known?.directory
      if (directory) remember({ id, directory, title: typeof data.title === 'string' ? data.title : known?.title ?? '',
        agent: typeof data.agent === 'string' ? data.agent : known?.agent,
        parentID: typeof data.parentID === 'string' ? data.parentID : known?.parentID })
      changed()
    }
    if (type === 'deleted') {
      state.sessions = state.sessions.filter(s => s.id !== id); pending.delete(id)
      state.permissions = state.permissions.filter(p => p.sessionID !== id)
      state.questions = state.questions.filter(q => q.sessionID !== id)
      if (state.selectedID === id) { epoch++; state.selectedID = ''; state.messages = []; state.permissions = []; state.busy = false }
      changed()
    }
    if (type === 'form.created' && isRecord(data.form)) setQuestions([...state.questions, data.form])
    if (type === 'form.replied' || type === 'form.cancelled') {
      state.questions = state.questions.filter(q => q.id !== data.id); changed()
    }
    if (belongs(id) && (/^(step\.ended|text\.ended|execution\.(succeeded|failed|interrupted))$/.test(type) || type.startsWith('permission.'))) void refresh()
  }
  return { state: () => state, belongs, submit, stop, reply, refresh, select, setDirectory, push, setQuestions,
    setAgent(agent: string) { if (writable() && !state.selectedID && state.agents.some(a => a.id === agent)) { state.agent = agent; changed() } },
    setSessions(sessions: WorkSession[]) { for (const session of sessions) remember(session); changed() },
    async loadProjects() { try { state.projects = await client.projects() } catch { state.notice = 'Project suggestions unavailable; enter the absolute directory.' } changed() },
    setReplay(replay: boolean) {
      epoch++; catalog++; reads++; state.replay = replay; state.busy = false; state.messages = []; state.permissions = []; state.questions = []; state.otherRequests = 0
      problems.clear()
      state.notice = replay ? 'Replay mode: job controls are disabled. Running live jobs are not stopped.' : 'Live job controls restored.'
      changed()
      if (!replay && state.selectedID) void select(state.selectedID)
      else if (!replay && state.directory && !state.agents.length) void setDirectory(state.directory)
    },
  }
}
