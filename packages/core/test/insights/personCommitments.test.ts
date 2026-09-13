import { describe, expect, it } from 'vitest';
import { aCommitment, aPerson } from '../builders';
import { ofKind, reversed, run, snapshotWith, clockAt } from './helpers';
import { computeInsights, DEFAULT_INSIGHT_SETTINGS } from '../../src/insights';

const sara = aPerson({ name: 'Sara' });

describe('open commitments per person', () => {
  it('lists from three open commitments, not two, with both directions subtotalled', () => {
    const two = [aCommitment({ personId: sara.id }), aCommitment({ personId: sara.id })];
    expect(ofKind(run({ people: [sara], commitments: two }), 'person-commitments')).toEqual([]);
    const three = [
      ...two,
      aCommitment({ personId: sara.id, direction: 'owed-to-me', text: 'Send the slides' }),
    ];
    const [insight] = ofKind(run({ people: [sara], commitments: three }), 'person-commitments');
    expect(insight).toMatchObject({
      key: `person-commitments:${sara.id}`,
      severity: 'info',
      subject: { type: 'person', id: sara.id },
      metrics: { open: 3, owedByMe: 2, owedToMe: 1 },
      threshold: { metric: 'openCommitments', actual: 3, operator: '>=', limit: 3, unit: 'count' },
    });
    expect(insight!.title).toBe(
      'There are 3 open commitments with Sara: 2 you owe and 1 owed to you.',
    );
    expect(insight!.evidence).toHaveLength(3);
    expect(insight!.evidence.map((e) => (e as { direction: string }).direction)).toContain(
      'owed-to-me',
    );
  });

  it('ignores done, dropped, deleted commitments, deleted people, and missing people', () => {
    const ghost = aPerson({ name: 'Ghost' });
    const gone = { ...ghost, deletedAt: new Date().toISOString() };
    const commitments = [
      aCommitment({ personId: sara.id }),
      aCommitment({ personId: sara.id }),
      aCommitment({ personId: sara.id, status: 'done' }),
      aCommitment({ personId: sara.id, status: 'dropped' }),
      { ...aCommitment({ personId: sara.id }), deletedAt: new Date().toISOString() },
      aCommitment({ personId: gone.id }),
      aCommitment({ personId: gone.id }),
      aCommitment({ personId: gone.id }),
      aCommitment({ personId: '019372a0-0000-7000-8000-00000000dead' }),
    ];
    const report = run({ people: [sara, gone], commitments });
    expect(ofKind(report, 'person-commitments')).toEqual([]);
    expect(report.coverage.find((c) => c.kind === 'person-commitments')).toMatchObject({
      subjects: 1,
      largestSample: 2,
      emitted: 0,
    });
  });

  it('orders evidence deterministically and honours the threshold setting', () => {
    const commitments = Array.from({ length: 4 }, (_, i) =>
      aCommitment({ personId: sara.id, text: `Item ${i}` }),
    );
    const snapshot = snapshotWith({ people: [sara], commitments });
    const input = {
      snapshot,
      settings: DEFAULT_INSIGHT_SETTINGS,
      planning: {
        workingWindow: { startMin: 540, endMin: 1080 },
        restBoundaries: [],
        defaultEstimateMin: 30,
      },
      clock: clockAt(),
    };
    const a = computeInsights(input).insights.find((i) => i.kind === 'person-commitments')!;
    const b = computeInsights({ ...input, snapshot: reversed(snapshot) }).insights.find(
      (i) => i.kind === 'person-commitments',
    )!;
    expect(a.evidence).toEqual(b.evidence);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(
      ofKind(
        run({ people: [sara], commitments }, { settings: { personCommitmentCount: 5 } }),
        'person-commitments',
      ),
    ).toEqual([]);
  });
});
