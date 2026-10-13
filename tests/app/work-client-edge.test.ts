import { it, expect } from 'vitest'
import { createWorkClient } from '../../src/app/work-client'

const clientFor = (body: unknown) => createWorkClient({ url: 'http://127.0.0.1:1', password: 'synthetic-only' }, async () => Response.json(body))
it('a new job cannot quietly use a different agent or become a child session', async () => {
  for (const patch of [{ agent: 'other' }, { agent: undefined }, { parentID: 'ses_parent' }]) {
    const client = clientFor({ data: { id: 'ses_new', location: { directory: '/synthetic/project' }, agent: 'build', ...patch } })
    await expect(client.create('/synthetic/project', 'build', 'Task')).rejects.toThrow()
  }
})
it('configured-agent choices must be from the requested project, not a default or previous location', async () => {
  const client = clientFor({ location: { directory: '/synthetic/other' }, data: [{ id: 'build', name: 'Build', mode: 'primary', hidden: false }] })
  await expect(client.agents('/synthetic/project')).rejects.toThrow()
})
it('reads approvals in the chosen project and refuses a default-location substitute', async () => {
  const paths: string[] = []
  const client = createWorkClient({ url: 'http://127.0.0.1:1', password: 'synthetic' }, async (_service, path) => {
    paths.push(path); return Response.json({ location: { directory: '/synthetic/project' }, data: [] })
  })
  expect(await client.permissions('/synthetic/project')).toEqual([])
  expect(paths).toEqual(['/api/permission/request?location[directory]=%2Fsynthetic%2Fproject'])
  await expect(clientFor({ location: { directory: '/synthetic/other' }, data: [] }).permissions('/synthetic/project')).rejects.toThrow()
})
