import { describe, expect, it } from 'vitest';
import type { ArchivedEpisode } from '../../src/narrative/series';
import type { Beat, SessionInfo } from '../../src/narrative/types';
import { computeBibles } from '../../src/narrative/bible';

const beat = (id: string, sessionID: string, kind: Beat['kind'], detail: Beat['detail']): Beat => ({
  id, at: 1, endAt: 2, eventIDs: [`e:${id}`], sessionID, kind, detail,
});
const episode = (id: string, sessions: SessionInfo[], beats: Beat[]): ArchivedEpisode => ({
  id, rootSessionID: `root-${id}`, seriesKey: 'series', sessions, beats,
});

describe('computeBibles', () => {
  it('counts an episode/beat once even when a repeated snapshot changes the agent name', () => {
    const old = episode('same', [{ id: 's' }], [beat('b', 's', 'wrap', { kind: 'wrap' })]);
    const learned = { ...old, sessions: [{ id: 's', agent: 'build' }] };
    const result = computeBibles([old, learned]);
    expect(result.reduce((sum, b) => sum + b.wraps.count, 0)).toBe(1);
    expect(result.map(b => b.agent)).toEqual(['unidentified']);
  });
  it('aggregates exact per-agent facts across root and guest sessions in first beat order', () => {
    const first = episode('ep1', [
      { id: 'root-ep1', agent: 'alpha:suffix' }, { id: 'guest', agent: 'alpha:suffix' },
      { id: 'other', agent: 'beta' },
    ], [
      beat('b1', 'guest', 'uses-tool', { kind: 'uses-tool', tool: '__proto__' }),
      beat('b2', 'root-ep1', 'thinks', { kind: 'thinks', deltas: 4 }),
      beat('b3', 'other', 'uses-tool', { kind: 'uses-tool', tool: 'constructor' }),
      beat('b4', 'guest', 'tool-fails', { kind: 'tool-fails', tool: '__proto__' }),
      beat('b5', 'guest', 'wrap', { kind: 'wrap' }),
      beat('b6', 'guest', 'cut', { kind: 'cut', reason: 'done' }),
      beat('b7', 'guest', 'knocks', { kind: 'knocks', requestID: 'r' }),
      beat('b8', 'guest', 'thinks', { kind: 'thinks', deltas: 0 }),
    ]);
    const second = episode('ep2', [{ id: 'root-ep2', agent: 'alpha:suffix' }], [
      beat('b9', 'root-ep2', 'thinks', { kind: 'thinks', deltas: 3 }),
      beat('b10', 'root-ep2', 'uses-tool', { kind: 'uses-tool', tool: 'constructor' }),
    ]);
    const result = computeBibles([first, second]);
    expect(result.map(({ agent }) => agent)).toEqual(['alpha:suffix', 'beta']);
    expect(result[0]).toEqual({
      agent: 'alpha:suffix', episodes: ['ep1', 'ep2'],
      tools: Object.fromEntries([['__proto__', { count: 2, refs: [{ episodeID: 'ep1', beatID: 'b1' }, { episodeID: 'ep1', beatID: 'b4' }] }], ['constructor', { count: 1, refs: [{ episodeID: 'ep2', beatID: 'b10' }] }]]),
      thinks: { runs: 3, deltas: 7, refs: [{ episodeID: 'ep1', beatID: 'b2' }, { episodeID: 'ep1', beatID: 'b8' }, { episodeID: 'ep2', beatID: 'b9' }] },
      wraps: { count: 1, refs: [{ episodeID: 'ep1', beatID: 'b5' }] },
      cuts: { count: 1, refs: [{ episodeID: 'ep1', beatID: 'b6' }] },
      knocks: { count: 1, refs: [{ episodeID: 'ep1', beatID: 'b7' }] },
    });
    expect(result[1].tools).toEqual({ constructor: { count: 1, refs: [{ episodeID: 'ep1', beatID: 'b3' }] } });
  });

  it('deduplicates episode/beat pairs, marks unknown agents and tools, and ignores empty participation', () => {
    const unknown = episode('ep', [{ id: 's' }], [
      beat('b', 'missing', 'thinks', { kind: 'thinks', deltas: 5 }),
      beat('u', 's', 'tool-fails', { kind: 'tool-fails', tool: 'unknown' }),
    ]);
    const duplicate = { ...unknown, beats: [...unknown.beats] };
    const result = computeBibles([unknown, duplicate]);
    expect(result).toEqual([{
      agent: 'unidentified', episodes: ['ep'], tools: { unknown: { count: 1, refs: [{ episodeID: 'ep', beatID: 'u' }] } },
      thinks: { runs: 1, deltas: 5, refs: [{ episodeID: 'ep', beatID: 'b' }] },
      wraps: { count: 0, refs: [] }, cuts: { count: 0, refs: [] }, knocks: { count: 0, refs: [] },
    }]);
    expect(computeBibles([])).toEqual([]);
    expect(unknown.beats).toHaveLength(2);
  });
});
