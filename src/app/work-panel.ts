import type { Service } from '../api/service'
import type { Frame } from '../api/sse'
import { createWorkClient, type WorkSession } from './work-client'
import { createWorkRuntime } from './work'
import { isID, isRecord } from '../narrative/evidence'
import { scopeFromSnapshot } from '../narrative/scope'

export function mountWorkPanel(element: HTMLElement, changed: () => void, created: (session: WorkSession) => void) {
  const field = <T extends HTMLElement>(id: string) => element.querySelector<T>(`#${id}`)!
  const form = field<HTMLFormElement>('work-form')
  const project = field<HTMLInputElement>('work-project')
  const suggestions = field<HTMLDataListElement>('work-projects')
  const agents = field<HTMLSelectElement>('work-agent')
  const jobs = field<HTMLSelectElement>('work-job')
  const prompt = field<HTMLTextAreaElement>('work-prompt')
  const submit = field<HTMLButtonElement>('work-submit')
  const loadAgents = field<HTMLButtonElement>('work-load-agents')
  const stop = field<HTMLButtonElement>('work-stop')
  const refresh = field<HTMLButtonElement>('work-refresh')
  const messages = field<HTMLDivElement>('work-messages')
  const permissions = field<HTMLDivElement>('work-permissions')
  const notice = field<HTMLParagraphElement>('work-notice')
  const roster = field<HTMLParagraphElement>('work-roster')
  let runtime: ReturnType<typeof createWorkRuntime> | undefined
  let connection: Service | undefined
  const options = (select: HTMLSelectElement | HTMLDataListElement, rows: { value: string; label: string }[], value?: string) => {
    const signature = JSON.stringify(rows)
    if (select.dataset.options !== signature) {
      select.replaceChildren(...rows.map(row => {
        const option = document.createElement('option')
        option.value = row.value; option.textContent = row.label
        return option
      }))
      select.dataset.options = signature
    }
    if (value !== undefined && select instanceof HTMLSelectElement) select.value = value
  }
  const render = () => {
    const state = runtime?.state()
    const disabled = !state || state.replay || state.busy
    prompt.disabled = submit.disabled = disabled
    project.disabled = agents.disabled = disabled || !!state?.selectedID
    loadAgents.disabled = disabled || !!state?.selectedID
    jobs.disabled = disabled
    stop.disabled = refresh.disabled = disabled || !state?.selectedID
    submit.textContent = state?.selectedID ? 'Send follow-up' : 'Start job'
    if (!state) { notice.textContent = 'Connecting to OpenCode…'; return }
    if (document.activeElement !== project || state.selectedID) project.value = state.directory
    options(suggestions, state.projects.map(p => ({ value: p.directory, label: p.label })))
    const choices = state.agents.map(a => ({ value: a.id, label: `${a.name} · ${a.model ?? 'configured model'}` }))
    if (state.selectedID && state.agent && !choices.some(a => a.value === state.agent)) choices.push({ value: state.agent, label: state.agent })
    options(agents, [{ value: '', label: 'Choose an agent…' }, ...choices], state.agent)
    options(jobs, [{ value: '', label: 'New job' }, ...state.sessions.filter(s => !s.parentID).reverse()
      .map(s => ({ value: s.id, label: `${s.title || s.id} · ${s.directory}` }))], state.selectedID)
    notice.textContent = state.notice
    roster.textContent = state.selectedID ? 'This job’s cast: ' + state.sessions.filter(s => runtime!.belongs(s.id))
      .map(s => `${s.agent ?? 'unidentified'} (${s.id})`).join(', ') : 'No job selected. Old idle sessions are not a team of active workers.'
    messages.replaceChildren(...state.messages.map(message => {
      const entry = document.createElement('div')
      const speaker = document.createElement('strong'); speaker.textContent = message.speaker
      const text = document.createElement('pre'); text.textContent = message.text + (message.truncated ? '\n[Display truncated]' : '')
      entry.append(speaker, text); return entry
    }))
    if (!state.messages.length) messages.textContent = state.replay ? 'Live conversation is hidden during replay.' :
      'Actual conversation appears here after a step finishes. No generated recap is substituted for it.'
    permissions.replaceChildren(...state.permissions.map(request => {
      const card = document.createElement('div'); card.className = 'work-permission'
      const title = document.createElement('strong'); title.textContent = `Permission needed: ${request.action}`
      const subject = document.createElement('p'); subject.textContent = `Session ${request.sessionID}`
      const resources = document.createElement('pre'); resources.textContent = request.resources.join('\n')
      card.append(title, subject, resources)
      if (request.message) { const message = document.createElement('p'); message.textContent = request.message; card.append(message) }
      for (const [label, decision] of [['Allow once', 'once'], ['Reject', 'reject']] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = disabled
        button.addEventListener('click', () => { void runtime?.reply(request.sessionID, request.id, decision) })
        card.append(button)
      }
      return card
    }))
    if (state.otherRequests) {
      const note = document.createElement('p')
      note.textContent = `${state.otherRequests} other or unlinked request(s) in this project are not shown here. Review them in OpenCode.`
      permissions.append(note)
    }
    for (const question of state.questions.filter(q => runtime!.belongs(q.sessionID))) {
      const note = document.createElement('p')
      note.textContent = `${question.title} — answer this structured question in OpenCode. This is not a permission approval.`
      permissions.append(note)
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault()
    const active = runtime, text = prompt.value
    if (!active) return
    void active.submit(text).then(accepted => {
      if (accepted && runtime === active && !active.state().replay && prompt.value === text) prompt.value = ''
    })
  })
  project.addEventListener('change', () => { void runtime?.setDirectory(project.value) })
  loadAgents.addEventListener('click', () => { void runtime?.setDirectory(project.value) })
  agents.addEventListener('change', () => runtime?.setAgent(agents.value))
  jobs.addEventListener('change', () => { void runtime?.select(jobs.value) })
  stop.addEventListener('click', () => { void runtime?.stop() })
  refresh.addEventListener('click', () => { void runtime?.refresh() })
  render()
  return {
    connect(service: Service) {
      if (connection?.url === service.url && connection.password === service.password && runtime) {
        runtime.setReplay(false); return
      }
      connection = service
      const next = createWorkRuntime(createWorkClient(service), () => { if (runtime === next) { render(); changed() } },
        session => { if (runtime === next) created(session) })
      runtime = next; render(); void next.loadProjects()
    },
    updateSessions(rows: unknown[]) {
      runtime?.setSessions(rows.flatMap(row => {
        const scope = scopeFromSnapshot(row)
        if (!isRecord(row) || !isID(row.id) || !row.id.startsWith('ses') || !scope?.startsWith('directory:')) return []
        return [{ id: row.id, directory: scope.slice(10), title: typeof row.title === 'string' ? row.title : '',
          agent: typeof row.agent === 'string' ? row.agent : undefined,
          parentID: typeof row.parentID === 'string' ? row.parentID : undefined }]
      }))
    },
    updateQuestions: (rows: unknown[]) => runtime?.setQuestions(rows),
    selectedID: () => runtime?.state().selectedID ?? '',
    push: (frame: Frame) => runtime?.push(frame),
    setReplay: (replay: boolean) => runtime?.setReplay(replay),
  }
}
