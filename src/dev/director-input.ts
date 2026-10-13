/** Byte-capped single-scene admission before any paid call. */
import type { DirectorRequest } from '../narrative/director'
import { assembleScenes } from '../narrative/scene'
import { isRecord, isID, parseEvidence } from '../narrative/evidence'

export const MAX_SCENE_BYTES = 32_768
export function parseDirectorRequest(value: unknown): DirectorRequest | undefined {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_SCENE_BYTES || !isRecord(value) ||
        Object.keys(value).some(k => !['sceneID', 'beats', 'sessions'].includes(k)) || !isID(value.sceneID, 512)) return undefined
    const evidence = parseEvidence(value.beats, value.sessions, 12, 128)
    if (!evidence) return undefined
    const request = { sceneID: value.sceneID, ...evidence }
    const scenes = assembleScenes(request.beats, request.sessions)
    if (scenes.length !== 1 || scenes[0].id !== request.sceneID) return undefined
    return JSON.parse(JSON.stringify(request)) as DirectorRequest
  } catch { return undefined }
}
