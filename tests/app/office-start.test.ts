import { it, expect } from 'vitest'
import { createWorkClient } from '../../src/app/work-client'
import { officeProjects, prepareOfficeProject } from '../../src/app/office-start'
import { createWorkRuntime } from '../../src/app/work'

it('current project comes from the validated server location, not a browser/renderer cwd guess', async () => {
  const paths: string[] = []
  const client = createWorkClient({ url: 'http://127.0.0.1:1', password: 'synthetic' }, async (_service, path) => {
    paths.push(path); return Response.json({ directory: '/synthetic/game', project: { id: 'p', directory: '/synthetic/game', canonical: '/synthetic/game' } })
  })
  expect(await client.currentProject()).toEqual({ directory: '/synthetic/game', label: 'game' })
  expect(paths).toEqual(['/api/location'])
})
it('friendly choices retain exact directory identity, avoid root and disambiguate matching names', () => {
  expect(officeProjects([{ directory: '/a/game', label: 'game' }, { directory: '/b/game', label: 'game' },
    { directory: '/', label: 'Global' }], { directory: '/current/project', label: 'project' })).toEqual([
    { directory: '/current/project', label: 'project' }, { directory: '/a/game', label: 'game · a' }, { directory: '/b/game', label: 'game · b' },
  ])
})
it('preparation defaults only a visible build agent and never starts work or picks arbitrary alternatives', async () => {
  let writes = 0
  const client = {
    projects: async () => [], currentProject: async () => ({ directory: '/synthetic/game', label: 'game' }),
    agents: async () => [{ id: 'build', name: 'Build' }, { id: 'premium', name: 'Astra' }],
    create: async () => { writes++; throw new Error('must not run') }, session: async () => { throw new Error('unused') },
    prompt: async () => { writes++ }, messages: async () => [], permissions: async () => [], reply: async () => { writes++ }, stop: async () => false,
  }
  const work = createWorkRuntime(client)
  await prepareOfficeProject(work, '/synthetic/game')
  expect(work.state().agent).toBe('build')
  expect(writes).toBe(0)
  const alternative = createWorkRuntime({ ...client, agents: async () => [{ id: 'premium', name: 'Astra' }] })
  await prepareOfficeProject(alternative, '/synthetic/other')
  expect(alternative.state().agent).toBe('')
  expect(writes).toBe(0)
})
