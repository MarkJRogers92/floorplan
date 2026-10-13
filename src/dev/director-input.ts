/** Byte-capped single-scene admission before any paid call. */
import type { DirectorRequest } from '../narrative/director'
import { assembleScenes } from '../narrative/scene'
import { isRecord, isID, parseEvidence } from '../narrative/evidence'
import { validSeriesKey } from '../narrative/scope'

export const MAX_SCENE_BYTES = 32_768
export function parseDirectorRequest(value: unknown): DirectorRequest | undefined {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_SCENE_BYTES || !isRecord(value) ||
        Object.keys(value).some(k => !['sceneID', 'beats', 'sessions', 'seriesKey'].includes(k)) || !isID(value.sceneID, 512) ||
        (value.seriesKey !== undefined && !validSeriesKey(value.seriesKey))) return undefined
    const evidence = parseEvidence(value.beats, value.sessions, 12, 128)
    if (!evidence) return undefined
    const request: DirectorRequest = { sceneID: value.sceneID, ...evidence }
    if (typeof value.seriesKey === 'string') request.seriesKey = value.seriesKey
    const scenes = assembleScenes(request.beats, request.sessions)
    if (scenes.length !== 1 || scenes[0].id !== request.sceneID) return undefined
    return JSON.parse(JSON.stringify(request)) as DirectorRequest
  } catch { return undefined }
}
