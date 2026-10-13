import type { Service } from '../api/service'
import type { Frame } from '../api/sse'
import { createWorkClient, type WorkSession, type WorkProject } from './work-client'
import { officeProjects, folderName, prepareOfficeProject } from './office-start'
import { createWorkRuntime } from './work'
import { isID, isRecord } from '../narrative/evidence'
import { scopeFromSnapshot } from '../narrative/scope'

export function mountWorkPanel(element: HTMLElement, changed: () => void, created: (session: WorkSession) => void) {
  const field = <T extends HTMLElement>(id: string) => element.querySelector<T>(`#${id}`)!
  const form = field<HTMLFormElement>('work-form')
  const project = field<HTMLInputElement>('work-project')
  const picker = field<HTMLSelectElement>('work-project-picker')
  const lead = field<HTMLSpanElement>('work-lead')
  const suggestions = field<HTMLDataListElement>('work-projects')
  const agents = field<HTMLSelectElement>('work-agent')
  const jobs = field<HTMLSelectElement>('work-job')
  const prompt = field<HTMLTextAreaElement>('work-prompt')
  const submit = field<HTMLButtonElement>('work-submit')
  const loadAgents = field<HTMLButtonElement>('work-load-agents')
  const stop = field<HTMLButtonElement>('work-stop')
  const newBrief = field<HTMLButtonElement>('work-new')
  const refresh = field<HTMLButtonElement>('work-refresh')
  const messages = field<HTMLDivElement>('work-messages')
  const permissions = field<HTMLDivElement>('work-permissions')
  const notice = field<HTMLParagraphElement>('work-notice')
  const roster = field<HTMLParagraphElement>('work-roster')
  let runtime: ReturnType<typeof createWorkRuntime> | undefined
  let connection: Service | undefined
  let currentProject: WorkProject | undefined
  let demo = false
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
    prompt.disabled = disabled
    submit.disabled = disabled || (!state?.selectedID && (!state?.directory || !state?.agent))
    project.disabled = agents.disabled = disabled || !!state?.selectedID
    picker.disabled = disabled || !!state?.selectedID
    loadAgents.disabled = disabled || !!state?.selectedID
    jobs.disabled = disabled
    stop.disabled = refresh.disabled = disabled || !state?.selectedID
    newBrief.hidden = !state?.selectedID; newBrief.disabled = disabled
    submit.textContent = demo ? 'Watching demo' : state?.selectedID ? 'Send follow-up' : "Let's do it"
    if (!state) { notice.textContent = demo ? 'Fictional office footage. Use my project to give your real team a brief.' : 'Watch the demo while the office connects.'; return }
    if (document.activeElement !== project || state.selectedID) project.value = state.directory
    options(suggestions, state.projects.map(p => ({ value: p.directory, label: p.label })))
    const selected = state.directory ? { directory: state.directory, label: state.projects.find(p => p.directory === state.directory)?.label ?? folderName(state.directory) } : currentProject
    options(picker, [{ value: '', label: 'Choose a project…' }, ...officeProjects(state.projects, selected)
      .map(p => ({ value: p.directory, label: p.label }))], state.directory)
    picker.title = state.directory
    const choices = state.agents.map(a => ({ value: a.id, label: `${a.name} · ${a.model ?? 'configured model'}` }))
    if (state.selectedID && state.agent && !choices.some(a => a.value === state.agent)) choices.push({ value: state.agent, label: state.agent })
    options(agents, [{ value: '', label: 'Choose an agent…' }, ...choices], state.agent)
    options(jobs, [{ value: '', label: 'New job' }, ...state.sessions.filter(s => !s.parentID).reverse()
      .map(s => ({ value: s.id, label: `${s.title || 'Untitled brief'} · ${folderName(s.directory)}` }))], state.selectedID)
    const agentName = state.agents.find(a => a.id === state.agent)?.name ?? state.agent
    lead.textContent = agentName ? `Lead: ${agentName}` : 'Your lead takes the brief.'
    notice.textContent = state.agent && !state.selectedID && state.notice === 'Choose an agent and enter your prompt.' ?
      `Talk to ${agentName}. They'll take it from here.` : state.notice
    if (demo) { notice.textContent = 'Fictional office footage. Use my project to give your real team a brief.'; lead.textContent = 'Fictional cast'; submit.textContent = 'Watching demo' }
    roster.textContent = !state.replay && state.selectedID ? 'On this brief: ' + state.sessions.filter(s => runtime!.belongs(s.id))
      .map(s => s.agent ?? 'Unidentified').join(' · ') : ''
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
  project.addEventListener('change', () => { if (runtime) void prepareOfficeProject(runtime, project.value) })
  picker.addEventListener('change', () => { if (runtime) void prepareOfficeProject(runtime, picker.value) })
  loadAgents.addEventListener('click', () => { if (runtime) void prepareOfficeProject(runtime, project.value) })
  agents.addEventListener('change', () => runtime?.setAgent(agents.value))
  const select = async (id: string) => {
    const active = runtime
    if (!active) return
    await active.select(id)
    if (!id && runtime === active && !active.state().selectedID) active.setAgent('build')
  }
  jobs.addEventListener('change', () => { void select(jobs.value) })
  newBrief.addEventListener('click', () => { void select('') })
  stop.addEventListener('click', () => { void runtime?.stop() })
  refresh.addEventListener('click', () => { void runtime?.refresh() })
  const loadDefault = (next: ReturnType<typeof createWorkRuntime>, client: ReturnType<typeof createWorkClient>) => {
    void client.currentProject().then(async project => {
      if (runtime !== next || next.state().replay || next.state().selectedID || next.state().directory) return
      currentProject = project; render()
      if (document.activeElement !== field('work-project')) await prepareOfficeProject(next, project.directory)
    }).catch(() => { /* Explicit project choices still work without a server default. */ })
  }
  render()
  return {
    connect(service: Service) {
      demo = false
      if (connection?.url === service.url && connection.password === service.password && runtime) {
        runtime.setReplay(false)
        if (!runtime.state().directory) loadDefault(runtime, createWorkClient(service))
        else if (!runtime.state().selectedID && !runtime.state().agent) void prepareOfficeProject(runtime, runtime.state().directory)
        return
      }
      connection = service
      const client = createWorkClient(service)
      const next = createWorkRuntime(client, () => { if (runtime === next) { render(); changed() } },
        session => { if (runtime === next) created(session) })
      runtime = next; render(); void next.loadProjects()
      loadDefault(next, client)
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
    setReplay: (replay: boolean, fictional = false) => { demo = fictional; runtime?.setReplay(replay); render() },
  }
}
