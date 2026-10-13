import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where OpenCode's server is listening, and the password to reach it. Never log the password. */
export type Service = { url: string; password: string }

export function defaultServicePath(): string {
  return join(homedir(), '.local/state/opencode/service.json')
}

/**
 * Read the service file, or throw an error that says plainly what is wrong.
 * Only our own path and the OS error code are interpolated — nothing read from the file.
 */
export function readService(path: string = defaultServicePath()): Service {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    const code = (cause as { code?: string }).code
    throw new Error(
      `OpenCode service file not found at ${path}${code ? ` (${code})` : ''}. Start the server with \`opencode serve\`.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`OpenCode service file is malformed: ${path} is not valid JSON.`)
  }

  const { url, password } = (parsed ?? {}) as Record<string, unknown>
  if (typeof url !== 'string' || typeof password !== 'string') {
    throw new Error(`OpenCode service file is malformed: ${path} has no string url and password.`)
  }

  return { url, password }
}
