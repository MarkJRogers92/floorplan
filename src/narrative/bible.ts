import type { ArchivedEpisode } from './series';

export type BeatRef = { episodeID: string; beatID: string };
export type CountFact = { count: number; refs: BeatRef[] };
export type CharacterBible = {
  agent: string;
  episodes: string[];
  tools: Record<string, CountFact>;
  thinks: { runs: number; deltas: number; refs: BeatRef[] };
  wraps: CountFact;
  cuts: CountFact;
  knocks: CountFact;
};

function fresh(agent: string): CharacterBible {
  return {
    agent, episodes: [], tools: Object.create(null), thinks: { runs: 0, deltas: 0, refs: [] },
    wraps: { count: 0, refs: [] }, cuts: { count: 0, refs: [] }, knocks: { count: 0, refs: [] },
  };
}

export function computeBibles(episodes: ArchivedEpisode[]): CharacterBible[] {
  const bibles = new Map<string, CharacterBible>();
  const seen = new Set<string>();
  for (const episode of episodes) {
    const sessions = new Map(episode.sessions.map((session) => [session.id, session]));
    for (const beat of episode.beats) {
      const agent = sessions.get(beat.sessionID)?.agent || 'unidentified';
      const key = JSON.stringify([episode.id, beat.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      let bible = bibles.get(agent);
      if (!bible) { bible = fresh(agent); bibles.set(agent, bible); }
      if (!bible.episodes.includes(episode.id)) bible.episodes.push(episode.id);
      const ref = { episodeID: episode.id, beatID: beat.id };
      if (beat.kind === 'uses-tool' || beat.kind === 'tool-fails') {
        const tool = beat.detail.kind === beat.kind && beat.detail.tool !== 'unknown' ? beat.detail.tool : 'unknown';
        const fact = bible.tools[tool] ?? (bible.tools[tool] = { count: 0, refs: [] });
        fact.count++; fact.refs.push(ref);
      } else if (beat.kind === 'thinks' && beat.detail.kind === 'thinks') {
        bible.thinks.runs++; bible.thinks.deltas += beat.detail.deltas; bible.thinks.refs.push(ref);
      } else if (beat.kind === 'wrap') { bible.wraps.count++; bible.wraps.refs.push(ref);
      } else if (beat.kind === 'cut') { bible.cuts.count++; bible.cuts.refs.push(ref);
      } else if (beat.kind === 'knocks') { bible.knocks.count++; bible.knocks.refs.push(ref); }
    }
  }
  return [...bibles.values()].map((bible) => ({ ...bible, tools: Object.fromEntries(Object.entries(bible.tools)) }));
}
