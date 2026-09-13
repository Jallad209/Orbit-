import type { InsightSettings } from '../schema';
import { byId, fingerprint } from './fingerprint';
import type { InsightIndex } from './snapshot';
import type { CommitmentEvidence, DetectorCoverage, Insight } from './types';
import { INSIGHT_ALGORITHM_VERSION } from './types';

/**
 * People with several open commitments, in either direction, with the two
 * directions counted separately in the copy so "owed to me" never reads
 * as something the user must do. Informational: it feeds the people view.
 */

export interface PersonCommitmentsResult {
  insights: Insight[];
  coverage: DetectorCoverage;
}

export function personCommitments(
  index: InsightIndex,
  settings: InsightSettings,
  computedAt: string,
): PersonCommitmentsResult {
  const insights: Insight[] = [];
  let largest = 0;
  const people = [...index.openCommitmentsByPerson.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [personId, open] of people) {
    largest = Math.max(largest, open.length);
    if (open.length < settings.personCommitmentCount) continue;
    const person = index.personById.get(personId)!;
    const evidence: CommitmentEvidence[] = [...open].sort(byId).map((c) => ({
      kind: 'commitment',
      ref: { type: 'commitment', id: c.id },
      text: c.text,
      direction: c.direction,
      dueAt: c.dueAt,
      personId,
    }));
    const owedByMe = evidence.filter((e) => e.direction === 'owed-by-me').length;
    const owedToMe = evidence.length - owedByMe;
    insights.push({
      key: `person-commitments:${personId}`,
      kind: 'person-commitments',
      severity: 'info',
      title: `There are ${evidence.length} open commitments with ${person.name}: ${owedByMe} you owe and ${owedToMe} owed to you.`,
      detail: `Listed from ${settings.personCommitmentCount} open commitments with one person. Done, dropped, and deleted commitments are not counted.`,
      subject: { type: 'person', id: personId },
      evidence,
      threshold: {
        metric: 'openCommitments',
        actual: evidence.length,
        operator: '>=',
        limit: settings.personCommitmentCount,
        unit: 'count',
        sampleSize: null,
        minSamples: null,
      },
      metrics: { open: evidence.length, owedByMe, owedToMe },
      range: null,
      notes: [],
      computedAt,
      fingerprint: fingerprint({
        v: INSIGHT_ALGORITHM_VERSION,
        person: personId,
        commitments: evidence.map((e) => [e.ref.id, e.direction, e.dueAt, e.text]),
        count: settings.personCommitmentCount,
      }),
      algorithmVersion: INSIGHT_ALGORITHM_VERSION,
    });
  }
  return {
    insights,
    coverage: {
      kind: 'person-commitments',
      subjects: people.length,
      eligible: people.length,
      emitted: insights.length,
      requiredSamples: null,
      largestSample: people.length ? largest : null,
      available: people.length > 0,
      unavailableReason: people.length > 0 ? null : 'no-subjects',
    },
  };
}
