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
})
