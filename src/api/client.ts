import type { Service } from './service'

/** The single authenticated entry point for every OpenCode API call. Returns the response unexamined. */
export function authedFetch(service: Service, path: string, init: RequestInit = {}): Promise<Response> {
  const base = service.url.replace(/\/+$/, '')
  const headers = new Headers(init.headers)
  const bytes = new TextEncoder().encode(`opencode:${service.password}`)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  headers.set('Authorization', 'Basic ' + btoa(binary))
  return fetch(base + path, { ...init, headers })
}
