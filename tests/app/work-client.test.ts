/**
 * Wire-contract tests for the work client. Synthetic responses only: no live
 * server, no provider call, no private recording. The injected request function
 * stands in for authedFetch and records exactly what would have been sent.
 */
import { describe, it, expect } from 'vitest'
import { createWorkClient } from '../../src/app/work-client'
import { authedFetch } from '../../src/api/client'
import type { Service } from '../../src/api/service'

const service: Service = { url: 'http://127.0.0.1:1', password: 'pw' }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const body = (init?: RequestInit) => JSON.parse(String(init?.body))
const failure = async (run: Promise<unknown>): Promise<string> => run.then(() => '', (error: Error) => error.message)

type Call = { path: string; init?: RequestInit }
const fake = (handler: (path: string, init?: RequestInit) => Response | Promise<Response>) => {
  const calls: Call[] = []
  const request: typeof authedFetch = async (_service, path, init) => {
    calls.push({ path, init })
    return handler(path, init)
  }
  return { calls, client: createWorkClient(service, request) }
}

describe('projects', () => {
  it('reads the raw array and falls back to the canonical path for the label', async () => {
    const { calls, client } = fake(() => json([
      { id: 'p1', canonical: '/work/app', name: 'App', time: {}, sandboxes: [] },
      { id: 'p2', canonical: '/work/other', time: {}, sandboxes: [] },
    ]))
    expect(await client.projects()).toEqual([
      { directory: '/work/app', label: 'App' },
      { directory: '/work/other', label: '/work/other' },
    ])
    expect(calls[0]).toEqual({ path: '/api/project', init: undefined })
  })

  it('refuses a malformed or oversized list instead of guessing', async () => {
    const bad = [
      { data: [] },
      [{ id: 'p', canonical: 'relative/path' }],
      [{ id: 'p', canonical: '/a\u0000b' }],
      [{ id: 'p', canonical: '/' + 'x'.repeat(4096) }],
      [{ id: 'p' }],
      Array.from({ length: 201 }, (_, i) => ({ id: `p${i}`, canonical: `/w/${i}` })),
    ]
    for (const value of bad) {
      const { client } = fake(() => json(value))
      expect(await failure(client.projects())).toBe('OpenCode response was not understood')
    }
  })
})

describe('agents', () => {
  it('keeps visible primary/all agents and reports the model as provider/model', async () => {
    const { calls, client } = fake(() => json({
      location: { directory: '/work/my app' },
      data: [
        { id: 'build', name: 'Build', mode: 'primary', hidden: false, model: { providerID: 'anthropic', id: 'claude' } },
        { id: 'general', name: 'General', mode: 'all', hidden: false },
        { id: 'quiet', name: 'Quiet', mode: 'primary', hidden: true },
        { id: 'sub', name: 'Sub', mode: 'subagent', hidden: false },
      ],
    }))
    expect(await client.agents('/work/my app')).toEqual([
      { id: 'build', name: 'Build', model: 'anthropic/claude' },
      { id: 'general', name: 'General' },
    ])
    expect(calls[0].path).toBe('/api/agent?location[directory]=%2Fwork%2Fmy%20app')
  })

  it('refuses an unknown mode, a duplicate id and an invalid directory', async () => {
    const rows = [
      [{ id: 'x', name: 'X', mode: 'seldom', hidden: false }],
      [{ id: 'x', name: 'X', mode: 'primary', hidden: false }, { id: 'x', name: 'X', mode: 'all', hidden: false }],
      [{ id: '', name: 'X', mode: 'primary', hidden: false }],
    ]
    for (const data of rows) {
      const { client } = fake(() => json({ location: { directory: '/a' }, data }))
      expect(await failure(client.agents('/a'))).toBe('OpenCode response was not understood')
    }
    const { calls, client } = fake(() => json({ data: [] }))
    expect(await failure(client.agents('relative/path'))).toBe('Invalid project directory')
    expect(calls).toHaveLength(0)
  })
})

describe('create session', () => {
  it('sends only location, agent and title and projects the session back', async () => {
    const { calls, client } = fake(() => json({ data: {
      id: 'ses_1', title: 'Fix it', agent: 'build', location: { directory: '/work/app' },
      projectID: 'p1', cost: 0, tokens: {}, time: { created: 1, updated: 1 },
    } }))
    expect(await client.create('/work/app', 'build', 'Fix it')).toEqual({
      id: 'ses_1', title: 'Fix it', directory: '/work/app', agent: 'build',
    })
    expect(calls[0].path).toBe('/api/session')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(body(calls[0].init)).toEqual({ location: { directory: '/work/app' }, agent: 'build', title: 'Fix it' })
  })

  it('refuses a session created at another directory rather than retargeting', async () => {
    const { client } = fake(() => json({ data: { id: 'ses_1', title: 'x', location: { directory: '/somewhere/else' } } }))
    expect(await failure(client.create('/work/app', 'build', 'x'))).toBe('OpenCode created the session at a different directory')
  })

  it('refuses an invalid directory, agent or title before any request', async () => {
    const { calls, client } = fake(() => json({ data: {} }))
    expect(await failure(client.create('relative', 'build', 'x'))).toBe('Invalid project directory')
    expect(await failure(client.create('/work/app', '', 'x'))).toBe('Invalid agent')
    expect(await failure(client.create('/work/app', 'build', 'x'.repeat(4097)))).toBe('Invalid title')
    expect(calls).toHaveLength(0)
  })
})

describe('session', () => {
  it('reads one session and refuses a substituted id', async () => {
    const { calls, client } = fake(() => json({ data: { id: 'ses_1', title: 'Job', location: { directory: '/work/app' } } }))
    expect(await client.session('ses_1')).toEqual({ id: 'ses_1', title: 'Job', directory: '/work/app' })
    expect(calls[0].path).toBe('/api/session/ses_1')
    const { client: other } = fake(() => json({ data: { id: 'ses_9', title: 'Job', location: { directory: '/work/app' } } }))
    expect(await failure(other.session('ses_1'))).toBe('OpenCode response was not understood')
  })

  it('refuses a session without a title or a session-shaped id', async () => {
    const { client } = fake(() => json({ data: { id: 'job-1', location: { directory: '/work/app' } } }))
    expect(await failure(client.session('ses_1'))).toBe('OpenCode response was not understood')
    const { calls, client: other } = fake(() => json({ data: {} }))
    expect(await failure(other.session('job-1'))).toBe('Invalid session id')
    expect(calls).toHaveLength(0)
  })
})

describe('prompt', () => {
  it('posts the exact steer body and requires an identical receipt', async () => {
    const { calls, client } = fake((_path, init) => {
      const sent = body(init)
      return json({ data: { id: sent.id, sessionID: 'ses_1', type: 'user', payload: { text: sent.text },
        delivery: 'steer', time: { created: 1 } } })
    })
    await client.prompt('ses_1', '  do the thing\n', 'msg_ab12')
    expect(calls[0].path).toBe('/api/session/ses_1/prompt')
    expect(calls[0].init?.method).toBe('POST')
    expect(body(calls[0].init)).toEqual({ id: 'msg_ab12', text: '  do the thing\n', delivery: 'steer', resume: true })
  })

  it('refuses a receipt for another message and never retries the post', async () => {
    const { calls, client } = fake(() => json({ data: { id: 'msg_zz', sessionID: 'ses_1', type: 'user',
      payload: { text: 'other' }, delivery: 'steer' } }))
    expect(await failure(client.prompt('ses_1', 'mine', 'msg_ab12'))).toBe('OpenCode response was not understood')
    expect(calls).toHaveLength(1)
    expect(body(calls[0].init).text).toBe('mine')
  })

  it('refuses empty, whitespace-only and oversized prompts before any request', async () => {
    const { calls, client } = fake(() => json({}))
    for (const text of ['', '   \n\t ', 'x'.repeat(16_001)]) {
      expect(await failure(client.prompt('ses_1', text, 'msg_1'))).toBe('Invalid prompt')
    }
    expect(await failure(client.prompt('job-1', 'hi', 'msg_1'))).toBe('Invalid session id')
    expect(await failure(client.prompt('ses_1', 'hi', 'client-1'))).toBe('Invalid prompt id')
    expect(calls).toHaveLength(0)
  })
})

describe('messages', () => {
  it('projects the last thirty messages oldest first, text parts only', async () => {
    const { calls, client } = fake(() => json({
      data: [
        { id: 'msg_2', type: 'assistant', agent: 'build', time: { created: 2 }, content: [
          { type: 'reasoning', text: 'private thinking' }, { type: 'text', text: 'Done.' }, { type: 'tool', name: 'read' }] },
        { id: 'msg_1', type: 'user', time: { created: 1 }, text: 'Please fix it' },
      ],
      cursor: {},
    }))
    expect(await client.messages('ses_1')).toEqual([
      { id: 'msg_1', speaker: 'You', text: 'Please fix it', truncated: false },
      { id: 'msg_2', speaker: 'build', text: 'Done.', truncated: false },
    ])
    expect(calls[0].path).toBe('/api/session/ses_1/message?limit=30&order=desc')
  })

  it('clips one message at 8000 characters and labels it', async () => {
    const { client } = fake(() => json({ data: [{ id: 'msg_1', type: 'user', time: { created: 1 }, text: 'y'.repeat(8001) }], cursor: {} }))
    const [message] = await client.messages('ses_1')
    expect(message.text).toHaveLength(8000)
    expect(message.truncated).toBe(true)
  })

  it('names an unnamed assistant Agent and skips messages with no text', async () => {
    const { client } = fake(() => json({ data: [
      { id: 'msg_2', type: 'assistant', time: { created: 2 }, content: [{ type: 'reasoning', text: 'hmm' }] },
      { id: 'msg_1', type: 'assistant', time: { created: 1 }, content: [{ type: 'text', text: 'Hi' }] },
    ], cursor: {} }))
    expect(await client.messages('ses_1')).toEqual([{ id: 'msg_1', speaker: 'Agent', text: 'Hi', truncated: false }])
  })

  it('refuses duplicate ids, too many rows and a non-message id', async () => {
    const dup = { id: 'msg_1', type: 'user', time: { created: 1 }, text: 'a' }
    const cases = [
      [dup, dup],
      Array.from({ length: 51 }, (_, i) => ({ id: `msg_${i}`, type: 'user', time: { created: 1 }, text: 'a' })),
      [{ id: 'note-1', type: 'user', time: { created: 1 }, text: 'a' }],
    ]
    for (const data of cases) {
      const { client } = fake(() => json({ data, cursor: {} }))
      expect(await failure(client.messages('ses_1'))).toBe('OpenCode response was not understood')
    }
  })
})

describe('permissions', () => {
  it('projects pending requests including their message', async () => {
    const { calls, client } = fake(() => json({ location: { directory: '/work/app' }, data: [
      { id: 'per_1', sessionID: 'ses_1', action: 'bash', resources: ['npm test'], message: 'Run tests?', save: [], metadata: {} },
      { id: 'per_2', sessionID: 'ses_2', action: 'edit', resources: ['/work/app/a.ts'] },
    ] }))
    expect(await client.permissions('/work/app')).toEqual([
      { id: 'per_1', sessionID: 'ses_1', action: 'bash', resources: ['npm test'], message: 'Run tests?' },
      { id: 'per_2', sessionID: 'ses_2', action: 'edit', resources: ['/work/app/a.ts'] },
    ])
    expect(calls[0]).toEqual({ path: '/api/permission/request?location[directory]=%2Fwork%2Fapp', init: undefined })
  })

  it('refuses a row whose id, session, action or resources are not as documented', async () => {
    const rows = [
      { id: 'request-1', sessionID: 'ses_1', action: 'a', resources: [] },
      { id: 'per_1', sessionID: 'job-1', action: 'a', resources: [] },
      { id: 'per_1', sessionID: 'ses_1', action: '', resources: [] },
      { id: 'per_1', sessionID: 'ses_1', action: 'a', resources: [7] },
      { id: 'per_1', sessionID: 'ses_1', action: 'a', resources: [], message: 5 },
    ]
    for (const row of rows) {
      const { client } = fake(() => json({ location: { directory: '/work/app' }, data: [row] }))
      expect(await failure(client.permissions('/work/app'))).toBe('OpenCode response was not understood')
    }
  })
})

describe('reply', () => {
  it('sends only the decision and accepts a bodyless 204', async () => {
    const { calls, client } = fake(() => new Response(null, { status: 204 }))
    await client.reply('ses_1', 'per_1', 'once')
    expect(calls[0].path).toBe('/api/session/ses_1/permission/per_1/reply')
    expect(calls[0].init?.method).toBe('POST')
    expect(body(calls[0].init)).toEqual({ decision: 'once' })
  })

  it('never sends allow-always and refuses an unknown decision before any request', async () => {
    const { calls, client } = fake(() => new Response(null, { status: 204 }))
    expect(await failure(client.reply('ses_1', 'per_1', 'always' as 'once'))).toBe('Invalid reply decision')
    await expect(client.reply('ses_1', 'per_1', 'reject')).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(body(calls[0].init)).toEqual({ decision: 'reject' })
  })

  it('reports a rejected reply as a generic failure without the server body', async () => {
    const { calls, client } = fake(() => json({ error: 'token sk-secret' }, 404))
    expect(await failure(client.reply('ses_1', 'per_1', 'once'))).toBe('OpenCode request failed (404)')
    expect(calls).toHaveLength(1)
  })
})

describe('stop', () => {
  it('stops with resume=false and keeps an idle no-op distinct from an interrupt', async () => {
    const { calls, client } = fake(() => json({ interrupted: false }))
    expect(await client.stop('ses_1')).toBe(false)
    expect(calls[0].path).toBe('/api/session/ses_1/interrupt?resume=false')
    expect(calls[0].init?.method).toBe('POST')
    const { client: busy } = fake(() => json({ interrupted: true }))
    expect(await busy.stop('ses_1')).toBe(true)
  })

  it('refuses an unreadable interrupt answer and an invalid session id', async () => {
    const { client } = fake(() => json({ interrupted: 'yes' }))
    expect(await failure(client.stop('ses_1'))).toBe('OpenCode response was not understood')
    const { calls, client: other } = fake(() => json({ interrupted: true }))
    expect(await failure(other.stop('job-1'))).toBe('Invalid session id')
    expect(calls).toHaveLength(0)
  })
})

describe('transport failures', () => {
  it('turns an HTTP failure into one generic, secret-free error', async () => {
    const { calls, client } = fake(() => new Response('{"error":"token sk-secret"}', { status: 500 }))
    expect(await failure(client.projects())).toBe('OpenCode request failed (500)')
    expect(await failure(client.session('ses_1'))).toBe('OpenCode request failed (500)')
    expect(await failure(client.messages('ses_1'))).toBe('OpenCode request failed (500)')
    expect(await failure(client.permissions('/work/app'))).toBe('OpenCode request failed (500)')
    expect(await failure(client.stop('ses_1'))).toBe('OpenCode request failed (500)')
    expect(calls).toHaveLength(5)
  })

  it('refuses a 200 body that is not the documented JSON', async () => {
    const { client } = fake(() => new Response('<html>proxy</html>', { status: 200 }))
    expect(await failure(client.permissions('/work/app'))).toBe('OpenCode response was not understood')
  })

  it('reports an unreachable server without echoing the transport error', async () => {
    const request: typeof authedFetch = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4096'))
    const client = createWorkClient(service, request)
    expect(await failure(client.projects())).toBe('OpenCode is unreachable')
    expect(await failure(client.create('/work/app', 'build', 'x'))).toBe('OpenCode is unreachable')
  })

  it('never retries a lost create or prompt', async () => {
    const { calls, client } = fake(() => { throw new Error('socket closed') })
    expect(await failure(client.create('/work/app', 'build', 'x'))).toBe('OpenCode is unreachable')
    expect(await failure(client.prompt('ses_1', 'hi', 'msg_1'))).toBe('OpenCode is unreachable')
    expect(calls).toHaveLength(2)
  })

  it('keeps concurrent reads independent', async () => {
    const { client } = fake(async (path) => {
      await new Promise(resolve => setTimeout(resolve, path.includes('ses_a') ? 5 : 0))
      return json({ data: [{ id: 'msg_1', type: 'user', time: { created: 1 }, text: path.includes('ses_a') ? 'A' : 'B' }], cursor: {} })
    })
    const [a, b] = await Promise.all([client.messages('ses_a'), client.messages('ses_b')])
    expect(a[0].text).toBe('A')
    expect(b[0].text).toBe('B')
  })
})
