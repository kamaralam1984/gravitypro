export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom'

export interface DateRange {
  preset: RangePreset
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

// Local calendar date, NOT toISOString().slice(0,10) — that returns the UTC
// date, which is wrong by a day for part of every day in any timezone ahead
// of UTC (e.g. IST, UTC+5:30): pressing "Today" between midnight and 5:30am
// IST would return yesterday's UTC date, silently showing yesterday's data
// labeled "Today" during exactly the hours a parent is most likely checking.
export const toDateStr = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function rangeForPreset(preset: RangePreset, customFrom?: string, customTo?: string): DateRange {
  const today = new Date()
  const todayStr = toDateStr(today)
  switch (preset) {
    case 'today':
      return { preset, from: todayStr, to: todayStr }
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      const yStr = toDateStr(y)
      return { preset, from: yStr, to: yStr }
    }
    case '7d': {
      const d = new Date(today); d.setDate(d.getDate() - 6)
      return { preset, from: toDateStr(d), to: todayStr }
    }
    case '30d': {
      const d = new Date(today); d.setDate(d.getDate() - 29)
      return { preset, from: toDateStr(d), to: todayStr }
    }
    case '90d': {
      const d = new Date(today); d.setDate(d.getDate() - 89)
      return { preset, from: toDateStr(d), to: todayStr }
    }
    case 'custom':
      return { preset, from: customFrom || todayStr, to: customTo || todayStr }
  }
}
