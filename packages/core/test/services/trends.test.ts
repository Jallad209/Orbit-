import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock';
import { createRecord } from '../../src/records';
import {
  AreaSchema,
  BillSchema,
  BlockSchema,
  DailyReflectionSchema,
  DayCommitmentSchema,
  ProjectSchema,
  SessionSchema,
  TaskSchema,
} from '../../src/schema';
import { buildWeeklyTrendReport } from '../../src/services/trends';

const clock = fixedClock('2026-09-09T12:00:00.000Z');
const localIso = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();

describe('weekly trends', () => {
  it('clips sessions, excludes running time, and never double-counts a manual actual', () => {
    const area = createRecord(AreaSchema, clock, { name: 'Work' });
    const project = createRecord(ProjectSchema, clock, { title: 'Launch', areaId: area.id });
    const timed = createRecord(TaskSchema, clock, {
      title: 'Timed',
      projectId: project.id,
      status: 'done',
      actualMin: 999,
      completedAt: localIso(9, 10),
    });
    const manual = createRecord(TaskSchema, clock, {
      title: 'Manual',
      areaId: area.id,
      status: 'done',
      actualMin: 30,
      completedAt: localIso(10, 10),
    });
    const sessions = [
      createRecord(SessionSchema, clock, {
        taskId: timed.id,
        startAt: localIso(6, 23, 30),
        endAt: localIso(7, 0, 30),
      }),
      createRecord(SessionSchema, clock, {
        taskId: timed.id,
        startAt: localIso(13, 23, 30),
        endAt: localIso(14, 0, 30),
      }),
      createRecord(SessionSchema, clock, {
        taskId: timed.id,
        startAt: localIso(10, 8),
        endAt: null,
      }),
    ];
    const report = buildWeeklyTrendReport('2026-09-07', {
      areas: [area],
      projects: [project],
      tasks: [timed, manual],
      sessions,
      blocks: [
        createRecord(BlockSchema, clock, {
          date: '2026-09-09',
          startMin: 540,
          endMin: 600,
          taskId: timed.id,
        }),
        createRecord(BlockSchema, clock, { date: '2026-09-09', startMin: 600, endMin: 660 }),
      ],
      commitments: [
        createRecord(DayCommitmentSchema, clock, {
          date: '2026-09-09',
          acceptedTaskIds: [timed.id],
          energy: 'low',
          acceptedAt: clock.now().toISOString(),
        }),
      ],
      reflections: [
        createRecord(DailyReflectionSchema, clock, {
          date: '2026-09-09',
          mood: 4,
          stress: 2,
          sleepQuality: 3,
          tags: ['focused'],
        }),
      ],
      bills: [
        createRecord(BillSchema, clock, {
          kind: 'expense',
          title: 'Food',
          amount: 5,
          currency: 'JOD',
          dueAt: '2026-09-09',
          paid: true,
        }),
        createRecord(BillSchema, clock, {
          kind: 'expense',
          title: 'Train',
          amount: 8,
          currency: 'USD',
          dueAt: '2026-09-10',
          paid: true,
        }),
        createRecord(BillSchema, clock, {
          kind: 'expense',
          title: ' food ',
          amount: 15,
          currency: 'JOD',
          dueAt: '2026-09-10',
          paid: true,
        }),
      ],
    });
    expect(report.timerMinutes).toBe(60);
    expect(report.manualMinutes).toBe(30);
    expect(report.actualMinutes).toBe(90);
    expect(report.runningSessions).toBe(1);
    expect(report.plannedMinutes).toBe(60);
    expect(report.byArea).toEqual([{ id: area.id, label: 'Work', minutes: 90 }]);
    expect(report.byProject).toEqual([
      { id: project.id, label: 'Launch', minutes: 60 },
      { id: null, label: 'Unassigned', minutes: 30 },
    ]);
    expect(report.coverage.text).toBe('2 of 2 completed tasks have recorded time.');
    expect(report.energy.low).toBe(1);
    expect(report.reflections).toMatchObject({ moodAverage: 4, stressAverage: 2, sleepAverage: 3 });
    expect(report.spending).toEqual({
      currencies: [
        { currency: 'JOD', total: 20, items: [{ name: 'Food', count: 2, total: 20 }] },
        { currency: 'USD', total: 8, items: [{ name: 'Train', count: 1, total: 8 }] },
      ],
    });
  });

  it('does not use manual actual when the task has a closed session outside the week', () => {
    const task = createRecord(TaskSchema, clock, {
      title: 'Spans history',
      status: 'done',
      actualMin: 45,
      completedAt: localIso(9, 10),
    });
    const old = createRecord(SessionSchema, clock, {
      taskId: task.id,
      startAt: localIso(1, 9),
      endAt: localIso(1, 10),
    });
    const report = buildWeeklyTrendReport('2026-09-07', {
      areas: [],
      projects: [],
      tasks: [task],
      sessions: [old],
      blocks: [],
      commitments: [],
      reflections: [],
    });
    expect(report.actualMinutes).toBe(0);
    expect(report.manualMinutes).toBe(0);
    expect(report.coverage.timedCompletedTasks).toBe(1);
  });
});
