import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { streamFrames } from '../../src/api/stream'
import type { Frame } from '../../src/api/sse'

describe('streamFrames', () => {
  it('delivers frames in order and ignores heartbeats', async () => {
    const s = createServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': heartbeat\n\n')
      for (const t of ['one', 'two', 'three']) {
        res.write(`data: ${JSON.stringify({ type: t, data: {} })}\n\n`)
        await new Promise(r => setTimeout(r, 5))
      }
      res.end()
    })
    s.listen(0, '127.0.0.1'); await once(s, 'listening')
    const { port } = s.address() as any

    const seen: Frame[] = []
    await streamFrames({ url: `http://127.0.0.1:${port}`, password: 'pw' }, '/api/event', f => seen.push(f))
    expect(seen.map(f => f.type)).toEqual(['one', 'two', 'three'])
    s.close()
  })

  it('carries partial frames across chunk boundaries', async () => {
    const payload = JSON.stringify({ type: 'split', data: { ok: true } })
    const s = createServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const mid = Math.floor(payload.length / 2)
      res.write(`data: ${payload.slice(0, mid)}`)
      await new Promise(r => setTimeout(r, 30))
      res.write(`${payload.slice(mid)}\n\n`)
      res.end()
    })
    s.listen(0, '127.0.0.1'); await once(s, 'listening')
    const { port } = s.address() as any

    const seen: Frame[] = []
    await streamFrames({ url: `http://127.0.0.1:${port}`, password: 'pw' }, '/api/event', f => seen.push(f))
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('split')
    expect((seen[0].data as { ok: boolean }).ok).toBe(true)
    s.close()
  })

  it('rejects when the server returns a non-OK response', async () => {
    const s = createServer(async (_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('internal error')
    })
    s.listen(0, '127.0.0.1'); await once(s, 'listening')
    const { port } = s.address() as any

    await expect(
      streamFrames({ url: `http://127.0.0.1:${port}`, password: 'pw' }, '/api/event', () => {}),
    ).rejects.toThrow('500')

    s.close()
  })
})
