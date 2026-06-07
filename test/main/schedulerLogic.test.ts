import { describe, it, expect } from 'vitest'
import type { Reminder } from '../../src/shared/types/reminders'
import {
  computeDueActions,
  isMissed,
  isNotifyDue,
  isRecordDue,
  isRecordStopDue,
  notifyAtSecs,
  recordStartSecs,
  recordStopSecs,
  isNotifyMode,
  isRecordMode
} from '../../src/main/reminders/schedulerLogic'

/** Build a reminder with sane defaults; override per test. */
function mk(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    streamId: 100,
    channelName: 'TF1',
    channelIcon: null,
    epgId: null,
    title: 'Match',
    description: null,
    startSecs: 1_000,
    endSecs: 4_600, // 1h programme
    leadSecs: 120,
    mode: 'notify',
    status: 'scheduled',
    filePath: null,
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

describe('mode helpers', () => {
  it('classifies notify/record modes', () => {
    expect(isNotifyMode('notify')).toBe(true)
    expect(isNotifyMode('notify_record')).toBe(true)
    expect(isNotifyMode('record')).toBe(false)
    expect(isRecordMode('record')).toBe(true)
    expect(isRecordMode('notify_record')).toBe(true)
    expect(isRecordMode('notify')).toBe(false)
  })
})

describe('window math', () => {
  it('computes notify/record windows from lead/padding', () => {
    const r = mk({ startSecs: 1000, endSecs: 4600, leadSecs: 120 })
    expect(notifyAtSecs(r)).toBe(880) // 1000 - 120
    expect(recordStartSecs(r, 60)).toBe(940) // 1000 - 60
    expect(recordStopSecs(r, 120)).toBe(4720) // 4600 + 120
  })
})

describe('isNotifyDue', () => {
  const r = mk({ startSecs: 1000, endSecs: 4600, leadSecs: 120, mode: 'notify' })
  it('is false before the lead instant', () => {
    expect(isNotifyDue(r, 879)).toBe(false)
  })
  it('is true at/after the lead instant while the show runs', () => {
    expect(isNotifyDue(r, 880)).toBe(true)
    expect(isNotifyDue(r, 1500)).toBe(true)
  })
  it('is false once the show ended', () => {
    expect(isNotifyDue(r, 4600)).toBe(false)
  })
  it('is false when already notified (anti-duplicate)', () => {
    expect(isNotifyDue({ ...r, status: 'notified' }, 900)).toBe(false)
  })
  it('is false for a record-only reminder', () => {
    expect(isNotifyDue({ ...r, mode: 'record' }, 900)).toBe(false)
  })
})

describe('isRecordDue', () => {
  const r = mk({ startSecs: 1000, endSecs: 4600, mode: 'record' })
  it('is true inside [start-padBefore, end+padAfter)', () => {
    expect(isRecordDue(r, 940, 60, 120)).toBe(true) // exactly start-padBefore
    expect(isRecordDue(r, 4719, 60, 120)).toBe(true) // just before stop
  })
  it('is false before the pad-before window', () => {
    expect(isRecordDue(r, 939, 60, 120)).toBe(false)
  })
  it('is false at/after end+padAfter', () => {
    expect(isRecordDue(r, 4720, 60, 120)).toBe(false)
  })
  it('is false for a notify-only reminder', () => {
    expect(isRecordDue({ ...r, mode: 'notify' }, 1000, 60, 120)).toBe(false)
  })
  it('allows restart from a prior conflict state', () => {
    expect(isRecordDue({ ...r, status: 'conflict' }, 1000, 60, 120)).toBe(true)
  })
  it('does not re-start when already recording', () => {
    expect(isRecordDue({ ...r, status: 'recording' }, 1000, 60, 120)).toBe(false)
  })
})

describe('isRecordStopDue', () => {
  const r = mk({ endSecs: 4600, status: 'recording' })
  it('stops at/after end+padAfter', () => {
    expect(isRecordStopDue(r, 4720, 120)).toBe(true)
    expect(isRecordStopDue(r, 4719, 120)).toBe(false)
  })
  it('is false unless currently recording', () => {
    expect(isRecordStopDue({ ...r, status: 'scheduled' }, 9999, 120)).toBe(false)
  })
})

describe('isMissed', () => {
  const r = mk({ startSecs: 1000, status: 'scheduled' })
  it('is true when start passed (beyond grace) and still scheduled', () => {
    expect(isMissed(r, 1061)).toBe(true) // grace 60 → 1000+60 < 1061
  })
  it('is false within the grace window', () => {
    expect(isMissed(r, 1060)).toBe(false)
  })
  it('is false once notified/recording', () => {
    expect(isMissed({ ...r, status: 'notified' }, 9999)).toBe(false)
  })
  it('marks a conflict recording missed only once its window (end+padAfter) passed', () => {
    const c = mk({ status: 'conflict', endSecs: 4600 })
    expect(isMissed(c, 4719, 60, 120)).toBe(false) // still inside [.., 4720)
    expect(isMissed(c, 4720, 60, 120)).toBe(true) // 4600 + 120
  })
})

describe('computeDueActions', () => {
  it('returns empty buckets when nothing is due', () => {
    const out = computeDueActions([mk({ startSecs: 100_000 })], 0, 60, 120)
    expect(out.toNotify).toHaveLength(0)
    expect(out.toStartRecording).toHaveLength(0)
    expect(out.toStopRecording).toHaveLength(0)
    expect(out.missed).toHaveLength(0)
  })

  it('notifies a notify reminder at lead time', () => {
    const r = mk({ id: 7, mode: 'notify', startSecs: 1000, leadSecs: 120 })
    const out = computeDueActions([r], 900, 60, 120)
    expect(out.toNotify.map((x) => x.id)).toEqual([7])
    expect(out.toStartRecording).toHaveLength(0)
  })

  it('a notify_record reminder both notifies and starts recording inside both windows', () => {
    // lead 120 → notify at 880; padBefore 60 → record at 940. At t=1000 both apply.
    const r = mk({ id: 9, mode: 'notify_record', startSecs: 1000, endSecs: 4600, leadSecs: 120 })
    const out = computeDueActions([r], 1000, 60, 120)
    expect(out.toNotify.map((x) => x.id)).toEqual([9])
    expect(out.toStartRecording.map((x) => x.id)).toEqual([9])
  })

  it('stops an in-progress recording at end+padAfter (and not double-counts)', () => {
    const r = mk({ id: 3, mode: 'record', status: 'recording', endSecs: 4600 })
    const out = computeDueActions([r], 4720, 60, 120)
    expect(out.toStopRecording.map((x) => x.id)).toEqual([3])
    expect(out.toStartRecording).toHaveLength(0)
    expect(out.missed).toHaveLength(0)
  })

  it('marks a scheduled notify reminder as missed when its start elapsed', () => {
    const r = mk({ id: 5, mode: 'notify', startSecs: 1000, endSecs: 4600, status: 'scheduled' })
    const out = computeDueActions([r], 5000, 60, 120)
    expect(out.missed.map((x) => x.id)).toEqual([5])
    expect(out.toNotify).toHaveLength(0)
  })

  it('does NOT mark a record reminder missed while still inside its recording window', () => {
    // start passed but we are still before end+padAfter → record, not missed.
    const r = mk({ id: 6, mode: 'record', startSecs: 1000, endSecs: 4600, status: 'scheduled' })
    const out = computeDueActions([r], 2000, 60, 120)
    expect(out.missed).toHaveLength(0)
    expect(out.toStartRecording.map((x) => x.id)).toEqual([6])
  })

  it('retries a conflict recording while still inside its window (B1)', () => {
    const r = mk({ id: 8, mode: 'record', status: 'conflict', startSecs: 1000, endSecs: 4600 })
    const out = computeDueActions([r], 2000, 60, 120)
    expect(out.toStartRecording.map((x) => x.id)).toEqual([8])
    expect(out.missed).toHaveLength(0)
  })

  it('marks a conflict recording missed once its window has fully passed (B1)', () => {
    const r = mk({ id: 8, mode: 'record', status: 'conflict', startSecs: 1000, endSecs: 4600 })
    const out = computeDueActions([r], 4720, 60, 120)
    expect(out.missed.map((x) => x.id)).toEqual([8])
    expect(out.toStartRecording).toHaveLength(0)
  })
})
