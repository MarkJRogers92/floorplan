import type { WorkProject } from './work-client'
import type { createWorkRuntime } from './work'

export const folderName = (directory: string) => directory.split('/').filter(Boolean).at(-1) ?? 'Computer root'

/** Names are presentation only; option values and tooltip keep the exact working directory. */
export function officeProjects(projects: WorkProject[], current?: WorkProject): WorkProject[] {
  const unique = new Map<string, WorkProject>()
  for (const project of [...(current ? [current] : []), ...projects]) {
    if (project.directory !== '/' && !unique.has(project.directory)) unique.set(project.directory, project)
  }
  const rows = [...unique.values()].map(p => ({ directory: p.directory, label: p.label.startsWith('/') ? folderName(p.directory) : p.label }))
  return rows.map(p => rows.filter(q => q.label === p.label).length > 1 ?
    { ...p, label: `${p.label} · ${p.directory.split('/').filter(Boolean).at(-2) ?? 'folder'}` } : p)
}

export async function prepareOfficeProject(work: ReturnType<typeof createWorkRuntime>, directory: string) {
  if (directory === '/') return
  await work.setDirectory(directory)
  const state = work.state()
  if (!state.replay && !state.selectedID && state.directory === directory && !state.agent && state.agents.some(a => a.id === 'build')) work.setAgent('build')
}
