import type { Service } from './service'

/** The single authenticated entry point for every OpenCode API call. Returns the response unexamined. */
export function authedFetch(service: Service, path: string, init: RequestInit = {}): Promise<Response> {
  const base = service.url.replace(/\/+$/, '')
  const headers = new Headers(init.headers)
  headers.set('Authorization', 'Basic ' + Buffer.from('opencode:' + service.password).toString('base64'))
  return fetch(base + path, { ...init, headers })
}
