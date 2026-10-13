import type { DirectorState } from '../narrative/director'

export function parseDirectorState(value: unknown): DirectorState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const s = value as Record<string, unknown>
  if (typeof s.available !== 'boolean' || typeof s.enabled !== 'boolean' || typeof s.model !== 'string' || s.model.length > 128 ||
      !['episodeCapCents', 'runCapCents', 'reservedCents'].every(k => typeof s[k] === 'number' && Number.isInteger(s[k]) && (s[k] as number) >= 0) ||
      !Array.isArray(s.excluded) || !s.excluded.every(id => typeof id === 'string' && id.length <= 256)) return null
  return { available: s.available, enabled: s.enabled, model: s.model, episodeCapCents: s.episodeCapCents as number,
    runCapCents: s.runCapCents as number, reservedCents: s.reservedCents as number, excluded: s.excluded as string[] }
}

export async function directorCall(action: 'state' | 'control' | 'opt-out' | 'scene', body?: unknown,
  signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  const response = await fetcher(`/__director/${action}`, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error('Director unavailable')
  return response.json()
}
