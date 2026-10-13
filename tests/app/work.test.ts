import { it, expect } from 'vitest'
import { createWorkRuntime } from '../../src/app/work'

const directory = '/synthetic/project'
const session = (id = 'ses_job', parentID?: string) => ({ id, directory, agent: 'build', title: 'A job', ...(parentID ? { parentID } : {}) })
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function boundary(patch: Record<string, unknown> = {}) {
  return {
    projects: async () => [{ directory, label: 'Project' }],
    currentProject: async () => ({ directory, label: 'Project' }),
    agents: async () => [{ id: 'build', name: 'Build', model: 'synthetic/model' }],
    create: async () => session(), session: async (id: string) => session(id),
    prompt: async (_session: string, _text: string, _id: string) => {},
    messages: async () => [], permissions: async () => [],
    reply: async (_session: string, _id: string, _decision: 'once' | 'reject') => {},
    stop: async (_session: string) => true, ...patch,
  }
}
async function prepared(patch: Record<string, unknown> = {}) {
  const api = boundary(patch)
  const runtime = createWorkRuntime(api)
  await runtime.setDirectory(directory)
  runtime.setAgent('build')
  return runtime
}
it('starting real work requires explicit project/agent/text and never runs at startup', async () => {
  let creates = 0
  const runtime = createWorkRuntime(boundary({ create: async () => { creates++; return session() } }))
  await runtime.loadProjects()
  expect(await runtime.submit('a task')).toBe(false)
  expect(creates).toBe(0)
  await runtime.setDirectory(directory)
  expect(await runtime.submit('a task')).toBe(false)
  runtime.setAgent('build')
  expect(await runtime.submit(' '.repeat(20))).toBe(false)
  expect(await runtime.submit('a'.repeat(16_001))).toBe(false)
  expect(creates).toBe(0)
})
it('one submit creates then prompts the exact session, and follow-up never creates a second root', async () => {
  const calls: unknown[][] = []
  const runtime = await prepared({
    create: async (...args: unknown[]) => { calls.push(['create', ...args]); return session() },
    prompt: async (...args: unknown[]) => { calls.push(['prompt', ...args]) },
  })
  expect(await runtime.submit('Implement the task')).toBe(true)
  expect(runtime.state().selectedID).toBe('ses_job')
  expect(calls[0].slice(0, 3)).toEqual(['create', directory, 'build'])
  expect(calls[1].slice(0, 3)).toEqual(['prompt', 'ses_job', 'Implement the task'])
  expect(calls[1][3]).toMatch(/^msg_/)
  expect(await runtime.submit('Now add tests')).toBe(true)
  expect(calls.filter(c => c[0] === 'create')).toHaveLength(1)
  expect(calls.at(-1)?.slice(0, 3)).toEqual(['prompt', 'ses_job', 'Now add tests'])
})
it('a double click cannot create or send twice while the first command is pending', async () => {
  let release!: (s: ReturnType<typeof session>) => void
  const pending = new Promise<ReturnType<typeof session>>(resolve => { release = resolve })
  let creates = 0, prompts = 0
  const runtime = await prepared({ create: async () => { creates++; return pending }, prompt: async () => { prompts++ } })
  const first = runtime.submit('Task')
  expect(await runtime.submit('Task')).toBe(false)
  release(session()); expect(await first).toBe(true)
  expect([creates, prompts]).toEqual([1, 1])
})
it('an uncertain send retains the created job and reuses its message ID on explicit identical retry', async () => {
  let creates = 0
  const ids: string[] = []
  const runtime = await prepared({
    create: async () => { creates++; return session() },
    prompt: async (_id: string, _text: string, message: string) => { ids.push(message); if (ids.length === 1) throw new Error('synthetic lost reply') },
  })
  expect(await runtime.submit('Task')).toBe(false)
  expect(runtime.state().selectedID).toBe('ses_job')
  expect(runtime.state().notice).toContain('may have reached OpenCode')
  expect(await runtime.submit('Task')).toBe(true)
  expect(creates).toBe(1)
  expect(ids[0]).toBe(ids[1])
  await runtime.submit('Task')
  expect(ids[2]).not.toBe(ids[1])
})
it('editing an uncertain prompt is a new explicit input, never an automatic resubmit', async () => {
  const ids: string[] = []
  const runtime = await prepared({ prompt: async (_id: string, _text: string, message: string) => { ids.push(message); throw new Error('synthetic') } })
  await runtime.submit('Task')
  await tick(); expect(ids).toHaveLength(1)
  await runtime.submit('Changed task')
  expect(ids[1]).not.toBe(ids[0])
})
it('project changes discard stale agent replies and clear the previous agent selection', async () => {
  let release!: (v: { id: string; name: string }[]) => void
  const pending = new Promise<{ id: string; name: string }[]>(resolve => { release = resolve })
  const runtime = createWorkRuntime(boundary({ agents: async (path: string) => path === directory ? pending : [{ id: 'plan', name: 'Plan' }] }))
  const old = runtime.setDirectory(directory)
  await runtime.setDirectory('/synthetic/other')
  release([{ id: 'build', name: 'Build' }]); await old
  expect(runtime.state().directory).toBe('/synthetic/other')
  expect(runtime.state().agents.map(a => a.id)).toEqual(['plan'])
  expect(runtime.state().agent).toBe('')
})
it('an existing job uses its stored directory and agent, not a new project selection', async () => {
  const runtime = await prepared({ session: async () => ({ ...session('ses_existing'), directory: '/synthetic/stored', agent: 'plan' }) })
  runtime.setSessions([session('ses_existing')])
  await runtime.select('ses_existing')
  expect(runtime.state().directory).toBe('/synthetic/stored')
  expect(runtime.state().agent).toBe('plan')
  await runtime.setDirectory('/synthetic/attempted-move')
  expect(runtime.state().directory).toBe('/synthetic/stored')
})
it('only the selected root and observed children can receive explicit permission replies', async () => {
  const calls: unknown[][] = []
  const requests = [
    { id: 'req_parent', sessionID: 'ses_job', action: 'shell', resources: ['echo safe'] },
    { id: 'req_child', sessionID: 'ses_child', action: 'write', resources: ['synthetic.txt'] },
    { id: 'req_other', sessionID: 'ses_other', action: 'shell', resources: ['other'] },
  ]
  const runtime = await prepared({ permissions: async () => requests, reply: async (...args: unknown[]) => { calls.push(args) } })
  runtime.setSessions([session(), session('ses_child', 'ses_job'), session('ses_other')])
  await runtime.select('ses_job')
  expect(runtime.state().permissions.map(p => p.id)).toEqual(['req_parent', 'req_child'])
  expect(await runtime.reply('ses_other', 'req_other', 'once')).toBe(false)
  expect(await runtime.reply('ses_child', 'req_child', 'once')).toBe(true)
  expect(calls).toEqual([['ses_child', 'req_child', 'once']])
})
it('stop preserves the job and reports idle as a no-op', async () => {
  const runtime = await prepared({ stop: async () => false })
  runtime.setSessions([session()]); await runtime.select('ses_job')
  expect(await runtime.stop()).toBe(true)
  expect(runtime.state().notice).toContain('already idle')
  expect(runtime.state().selectedID).toBe('ses_job')
})
it('replay refuses submit, stop and permission replies even when called directly', async () => {
  let writes = 0
  const runtime = await prepared({ prompt: async () => { writes++ }, stop: async () => { writes++; return true }, reply: async () => { writes++ } })
  runtime.setSessions([session()]); await runtime.select('ses_job')
  runtime.setReplay(true)
  expect(await runtime.submit('Task')).toBe(false)
  expect(await runtime.stop()).toBe(false)
  expect(await runtime.reply('ses_job', 'req_parent', 'once')).toBe(false)
  expect(writes).toBe(0)
})
it('switching to replay during session creation prevents the subsequent prompt from running', async () => {
  let release!: (s: ReturnType<typeof session>) => void
  const pending = new Promise<ReturnType<typeof session>>(resolve => { release = resolve })
  let sends = 0
  const runtime = await prepared({ create: async () => pending, prompt: async () => { sends++ } })
  const command = runtime.submit('Task')
  runtime.setReplay(true)
  release(session()); expect(await command).toBe(false)
  expect(sends).toBe(0)
  expect(runtime.state().replay).toBe(true)
})
it('a late previous-job transcript cannot overwrite the new selection or replay', async () => {
  let release!: (v: { id: string; speaker: string; text: string; truncated: boolean }[]) => void
  const pending = new Promise<{ id: string; speaker: string; text: string; truncated: boolean }[]>(resolve => { release = resolve })
  const runtime = await prepared({ messages: async (id: string) => id === 'ses_old' ? pending : [{ id: 'msg_new', speaker: 'You', text: 'Current', truncated: false }] })
  runtime.setSessions([session('ses_old'), session('ses_new')])
  const old = runtime.select('ses_old'); await tick()
  await runtime.select('ses_new')
  release([{ id: 'msg_old', speaker: 'You', text: 'Old private context', truncated: false }]); await old
  expect(runtime.state().messages.map(m => m.text)).toEqual(['Current'])
  runtime.setReplay(true)
  expect(runtime.state().messages).toEqual([])
})
it('New job reloads agents for the stored directory, never reuses choices from an older project', async () => {
  const paths: string[] = []
  const runtime = await prepared({
    session: async () => ({ ...session('ses_stored'), directory: '/synthetic/stored', agent: 'plan' }),
    agents: async (path: string) => { paths.push(path); return [{ id: path === directory ? 'build' : 'plan', name: 'Agent' }] },
  })
  runtime.setSessions([session('ses_stored')]); await runtime.select('ses_stored')
  await runtime.select(''); await tick()
  expect(paths).toEqual([directory, '/synthetic/stored'])
  expect(runtime.state().agents.map(a => a.id)).toEqual(['plan'])
  expect(runtime.state().agent).toBe('')
})
it('deleted child sessions lose their permission cards and can no longer receive replies', async () => {
  let replies = 0
  const runtime = await prepared({ permissions: async () => [{ id: 'per_child', sessionID: 'ses_child', action: 'write', resources: ['synthetic.txt'] }],
    reply: async () => { replies++ } })
  runtime.setSessions([session(), session('ses_child', 'ses_job')]); await runtime.select('ses_job')
  runtime.push({ type: 'session.deleted', data: { sessionID: 'ses_child' }, id: 'deleted', created: 2000 })
  expect(runtime.state().permissions).toEqual([])
  expect(await runtime.reply('ses_child', 'per_child', 'once')).toBe(false)
  expect(replies).toBe(0)
})
it('replay hides live structured questions as well as conversation and permissions', async () => {
  const runtime = await prepared()
  runtime.setSessions([session()]); await runtime.select('ses_job')
  runtime.setQuestions([{ id: 'form_question', sessionID: 'ses_job', title: 'A live question' }])
  expect(runtime.state().questions).toHaveLength(1)
  runtime.setReplay(true)
  expect(runtime.state().questions).toEqual([])
})
it('returning live reloads agent choices when replay canceled a project read', async () => {
  let release!: (v: { id: string; name: string }[]) => void
  const pending = new Promise<{ id: string; name: string }[]>(resolve => { release = resolve })
  let loads = 0
  const runtime = createWorkRuntime(boundary({ agents: async () => ++loads === 1 ? pending : [{ id: 'build', name: 'Build' }] }))
  const first = runtime.setDirectory(directory)
  runtime.setReplay(true)
  release([{ id: 'old', name: 'Old' }]); await first
  runtime.setReplay(false); await tick()
  expect(runtime.state().agents.map(a => a.id)).toEqual(['build'])
  expect(loads).toBe(2)
})
it('a valid absolute directory is preserved exactly, including meaningful trailing spaces', async () => {
  const runtime = createWorkRuntime(boundary())
  await runtime.setDirectory('/synthetic/folder ')
  expect(runtime.state().directory).toBe('/synthetic/folder ')
})
it('a failed transcript read does not hide the selected job’s actionable permission request', async () => {
  let replies = 0
  const paths: string[] = []
  const runtime = await prepared({ messages: async () => { throw new Error('synthetic transcript failure') },
    permissions: async (path: string) => { paths.push(path); return [{ id: 'per_parent', sessionID: 'ses_job', action: 'write', resources: ['synthetic.txt'] }] },
    reply: async () => { replies++ } })
  runtime.setSessions([session()]); await runtime.select('ses_job')
  expect(runtime.state().permissions.map(p => p.id)).toEqual(['per_parent'])
  expect(paths).toEqual([directory])
  expect(await runtime.reply('ses_job', 'per_parent', 'once')).toBe(true)
  expect(replies).toBe(1)
})
it('unlinked or other-job requests are counted, not misrepresented as an empty project queue', async () => {
  const runtime = await prepared({ permissions: async () => [{ id: 'per_unknown', sessionID: 'ses_unseen', action: 'write', resources: ['synthetic.txt'] }] })
  runtime.setSessions([session()]); await runtime.select('ses_job')
  expect(runtime.state().otherRequests).toBe(1)
  expect(runtime.state().permissions).toEqual([])
})
it('a lost create response is described as unconfirmed, never a claim that no session exists', async () => {
  const runtime = await prepared({ create: async () => { throw new Error('synthetic response lost after creation') } })
  expect(await runtime.submit('Task')).toBe(false)
  expect(runtime.state().notice).toContain('Could not confirm the new job')
  expect(runtime.state().notice).toContain('may have created a session')
})
it('a late old receipt cannot discard the retry ID of a newer uncertain input in the same job', async () => {
  let release!: () => void
  const old = new Promise<void>(resolve => { release = resolve })
  const ids: string[] = []
  const runtime = await prepared({ prompt: async (_session: string, _text: string, id: string) => {
    ids.push(id); if (ids.length === 1) return old
    throw new Error('synthetic newer response lost after admission')
  } })
  const first = runtime.submit('Old input'); await tick()
  runtime.setReplay(true); runtime.setReplay(false); await tick()
  expect(await runtime.submit('New input')).toBe(false)
  release(); expect(await first).toBe(false)
  expect(await runtime.submit('New input')).toBe(false)
  expect(ids[2]).toBe(ids[1])
})
it('a successful permission reply frees controls even when its transcript refresh hangs', async () => {
  let reads = 0
  const hung = new Promise<[]>(() => {})
  const runtime = await prepared({ messages: async () => ++reads === 1 ? [] : hung,
    permissions: async () => [{ id: 'per_parent', sessionID: 'ses_job', action: 'write', resources: ['synthetic.txt'] }] })
  runtime.setSessions([session()]); await runtime.select('ses_job')
  const reply = runtime.reply('ses_job', 'per_parent', 'once'); await tick()
  expect(runtime.state().busy).toBe(false)
  expect(await reply).toBe(true)
  expect(await runtime.stop()).toBe(true)
})
it('a recovered permission read clears its stale unavailable notice', async () => {
  let calls = 0
  const runtime = await prepared({ permissions: async () => {
    if (++calls === 1) throw new Error('synthetic transient read failure')
    return [{ id: 'per_parent', sessionID: 'ses_job', action: 'write', resources: ['synthetic.txt'] }]
  } })
  runtime.setSessions([session()]); await runtime.select('ses_job')
  expect(runtime.state().notice).toContain('Permissions unavailable')
  await runtime.refresh()
  expect(runtime.state().notice).not.toContain('unavailable')
  expect(runtime.state().permissions.map(p => p.id)).toEqual(['per_parent'])
})
