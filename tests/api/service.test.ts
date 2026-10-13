import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readService } from '../../src/api/service'

describe('readService', () => {
  it('returns url and password from a valid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-'))
    const p = join(dir, 'service.json')
    writeFileSync(p, JSON.stringify({ url: 'http://127.0.0.1:49374', password: 'abc' }))
    expect(readService(p)).toEqual({ url: 'http://127.0.0.1:49374', password: 'abc' })
  })

  it('names the path when the file is missing', () => {
    const p = join(tmpdir(), 'definitely-not-there-9f3a', 'service.json')
    expect(() => readService(p)).toThrow(/not found/i)
    expect(() => readService(p)).toThrow(p)
    expect(() => readService(p)).toThrow(/opencode serve/)
  })

  it('throws a distinct error when the JSON is present but incomplete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-'))
    const p = join(dir, 'service.json')
    writeFileSync(p, JSON.stringify({ url: 'http://127.0.0.1:1' }))
    expect(() => readService(p)).toThrow(/malformed/i)
  })

  it('never includes the password in an error message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-'))
    const p = join(dir, 'service.json')
    writeFileSync(p, JSON.stringify({ url: 5, password: 'SUPERSECRET' }))
    try { readService(p) } catch (e) {
      expect(String((e as Error).message)).not.toContain('SUPERSECRET')
    }
  })
})
