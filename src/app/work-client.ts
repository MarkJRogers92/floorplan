/**
 * Validated client for the V2 work routes (spec docs/superpowers/specs/2026-10-13-prompt-to-work-design.md).
 *
 * A prompt can be admitted even when its response is lost, so nothing here retries, remembers or
 * invents state: callers keep the submission id and decide what an uncertain send means. Every
 * response is validated against the documented contract and projected to the fields the panel
 * renders; anything else is refused rather than guessed, and errors never echo the server body.
 */
import { authedFetch } from '../api/client'
import type { Service } from '../api/service'

export type WorkProject = { directory: string; label: string }
export type WorkAgent = { id: string; name: string; model?: string }
export type WorkSession = { id: string; title: string; directory: string; agent?: string; parentID?: string }
export type WorkMessage = { id: string; speaker: string; text: string; truncated: boolean }
export type WorkPermission = { id: string; sessionID: string; action: string; resources: string[]; message?: string }

const MAX_ID = 256
const MAX_PATH = 4096
const MAX_PROMPT = 16_000
const MAX_TITLE = 4096
const MAX_ROWS = 200
const MAX_MESSAGES = 50
const MAX_RESOURCES = 100
const CLIP = 8000
/** Session.ID / Session.Message.ID / Permission.ID patterns from the public OpenAPI. */
const SESSION = /^ses/
const MESSAGE = /^msg_/
const PERMISSION = /^per/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isID = (v: unknown, pattern?: RegExp): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_ID && (!pattern || pattern.test(v))
/** Absolute POSIX path, the only directory shape the writer accepts. */
const isDirectory = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_PATH && v.startsWith('/') && !v.includes('\u0000')

const refuse = (message = 'OpenCode response was not understood'): never => { throw new Error(message) }
const bad = (what: string): never => refuse(`Invalid ${what}`)
const failed = (status: number): never => refuse(`OpenCode request failed (${status})`)

export function createWorkClient(service: Service, request: typeof authedFetch = authedFetch) {
  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    try { return await request(service, path, init) }
    catch { return refuse('OpenCode is unreachable') }
  }
  const json = async (response: Response): Promise<unknown> => {
    if (!response.ok) failed(response.status)
    return response.json().catch(() => refuse())
  }

  /** Session.Info projection; every field is read from the wire, none is assumed. */
  const project = (value: unknown): WorkSession => {
    const data = isRecord(value) && isRecord(value.data) ? value.data : refuse()
    if (!isID(data.id, SESSION) || !isRecord(data.location) || !isDirectory(data.location.directory)) return refuse()
    if (data.agent !== undefined && !isID(data.agent)) return refuse()
    if (data.parentID !== undefined && !isID(data.parentID, SESSION)) return refuse()
    const session: WorkSession = { id: data.id, title: isString(data.title) ? data.title : '', directory: data.location.directory }
    if (data.agent !== undefined) session.agent = data.agent
    if (data.parentID !== undefined) session.parentID = data.parentID
    return session
  }

  /** Assistant.Message content, text parts only: reasoning and tool arguments stay on the server. */
  const assistantText = (content: unknown): string => {
    if (!Array.isArray(content)) return refuse()
    let text = ''
    for (const part of content) {
      if (!isRecord(part)) return refuse()
      if (part.type !== 'text') continue
      if (!isString(part.text)) return refuse()
      text += part.text
    }
    return text
  }

  const projects = async (): Promise<WorkProject[]> => {
    const body = await json(await send('/api/project'))
    if (!Array.isArray(body) || body.length > MAX_ROWS) return refuse()
    return body.map(raw => {
      if (!isRecord(raw) || !isDirectory(raw.canonical)) return refuse()
      return { directory: raw.canonical, label: isString(raw.name) && raw.name.length ? raw.name : raw.canonical }
    })
  }

  const currentProject = async (): Promise<WorkProject> => {
    const body = await json(await send('/api/location'))
    if (!isRecord(body) || !isDirectory(body.directory)) return refuse()
    return { directory: body.directory, label: body.directory.split('/').filter(Boolean).at(-1) ?? 'Computer root' }
  }

  const agents = async (directory: string): Promise<WorkAgent[]> => {
    if (!isDirectory(directory)) return bad('project directory')
    const body = await json(await send(`/api/agent?location[directory]=${encodeURIComponent(directory)}`))
    if (!isRecord(body) || !isRecord(body.location) || body.location.directory !== directory ||
      !Array.isArray(body.data) || body.data.length > MAX_ROWS) return refuse()
    const seen = new Set<string>()
    const list: WorkAgent[] = []
    for (const raw of body.data) {
      if (!isRecord(raw) || !isID(raw.id) || seen.has(raw.id) || !isString(raw.name) || typeof raw.hidden !== 'boolean' ||
          (raw.mode !== 'primary' && raw.mode !== 'all' && raw.mode !== 'subagent')) return refuse()
      seen.add(raw.id)
      if (raw.hidden || raw.mode === 'subagent') continue
      const model = isRecord(raw.model) && isString(raw.model.providerID) && isString(raw.model.id)
        ? `${raw.model.providerID}/${raw.model.id}` : undefined
      list.push(model === undefined ? { id: raw.id, name: raw.name } : { id: raw.id, name: raw.name, model })
    }
    return list
  }

  const create = async (directory: string, agent: string, title: string): Promise<WorkSession> => {
    if (!isDirectory(directory)) return bad('project directory')
    if (!isID(agent)) return bad('agent')
    if (!isString(title) || title.length > MAX_TITLE || title.includes('\u0000')) return bad('title')
    const session = project(await json(await send('/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { directory }, agent, title }),
    })))
    if (session.directory !== directory) return refuse('OpenCode created the session at a different directory')
    if (session.agent !== agent || session.parentID !== undefined) return refuse()
    return session
  }

  const session = async (id: string): Promise<WorkSession> => {
    if (!isID(id, SESSION)) return bad('session id')
    const found = project(await json(await send(`/api/session/${encodeURIComponent(id)}`)))
    if (found.id !== id) return refuse()
    return found
  }

  const prompt = async (sessionID: string, text: string, id: string): Promise<void> => {
    if (!isID(sessionID, SESSION)) return bad('session id')
    if (!isID(id, MESSAGE)) return bad('prompt id')
    if (!isString(text) || text.length < 1 || text.length > MAX_PROMPT || !/\S/.test(text)) return bad('prompt')
    const body = await json(await send(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, text, delivery: 'steer', resume: true }),
    }))
    // The receipt must name the message we submitted, for this session, with this text and delivery.
    const data = isRecord(body) && isRecord(body.data) ? body.data : refuse()
    if (data.id !== id || data.sessionID !== sessionID || data.type !== 'user' || data.delivery !== 'steer') return refuse()
    if (!isRecord(data.payload) || data.payload.text !== text) return refuse()
  }

  const messages = async (sessionID: string): Promise<WorkMessage[]> => {
    if (!isID(sessionID, SESSION)) return bad('session id')
    const body = await json(await send(`/api/session/${encodeURIComponent(sessionID)}/message?limit=30&order=desc`))
    if (!isRecord(body) || !isRecord(body.cursor) || !Array.isArray(body.data) || body.data.length > MAX_MESSAGES) return refuse()
    const seen = new Set<string>()
    const list: WorkMessage[] = []
    for (const raw of [...body.data].reverse()) { // wire order is newest first; the panel reads oldest first
      if (!isRecord(raw) || !isID(raw.id, MESSAGE) || seen.has(raw.id)) return refuse()
      seen.add(raw.id)
      const text = raw.type === 'user' ? (isString(raw.text) ? raw.text : refuse())
        : raw.type === 'assistant' ? assistantText(raw.content) : undefined
      if (!text) continue
      list.push({ id: raw.id, speaker: raw.type === 'user' ? 'You' : (isID(raw.agent) ? raw.agent : 'Agent'),
        text: text.slice(0, CLIP), truncated: text.length > CLIP })
    }
    return list
  }

  const permissions = async (directory: string): Promise<WorkPermission[]> => {
    if (!isDirectory(directory)) return bad('project directory')
    const body = await json(await send(`/api/permission/request?location[directory]=${encodeURIComponent(directory)}`))
    if (!isRecord(body) || !isRecord(body.location) || body.location.directory !== directory ||
      !Array.isArray(body.data) || body.data.length > MAX_ROWS) return refuse()
    const seen = new Set<string>()
    return body.data.map(raw => {
      if (!isRecord(raw) || !isID(raw.id, PERMISSION) || seen.has(raw.id) || !isID(raw.sessionID, SESSION) ||
          !isString(raw.action) || !raw.action.length || !Array.isArray(raw.resources) ||
          raw.resources.length > MAX_RESOURCES || raw.resources.some(r => !isString(r) || r.length > MAX_PATH) ||
          (raw.message !== undefined && !isString(raw.message))) return refuse()
      seen.add(raw.id)
      const permission: WorkPermission = { id: raw.id, sessionID: raw.sessionID, action: raw.action, resources: raw.resources }
      if (isString(raw.message)) permission.message = raw.message
      return permission
    })
  }

  const reply = async (sessionID: string, requestID: string, decision: 'once' | 'reject'): Promise<void> => {
    if (!isID(sessionID, SESSION)) return bad('session id')
    if (!isID(requestID, PERMISSION)) return bad('permission request id')
    if (decision !== 'once' && decision !== 'reject') return bad('reply decision')
    const response = await send(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    })
    if (!response.ok) return failed(response.status) // 204, so nothing to read
  }

  const stop = async (sessionID: string): Promise<boolean> => {
    if (!isID(sessionID, SESSION)) return bad('session id')
    const body = await json(await send(`/api/session/${encodeURIComponent(sessionID)}/interrupt?resume=false`, { method: 'POST' }))
    if (!isRecord(body) || typeof body.interrupted !== 'boolean') return refuse()
    return body.interrupted
  }

  return { projects, currentProject, agents, create, session, prompt, messages, permissions, reply, stop }
}
