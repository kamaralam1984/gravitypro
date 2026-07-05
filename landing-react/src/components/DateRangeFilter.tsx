import { useEffect, useState } from 'react'
import styles from './DateRangeFilter.module.css'
import { rangeForPreset, toDateStr } from './dateRange'
import type { RangePreset, DateRange } from './dateRange'

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
  // Defaults to the Travel Timeline's preset set; Smart Places passes the
  // longer list (adds "Last 90 Days") without duplicating this component.
  presets?: RangePreset[]
}

const ALL_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'custom', label: 'Custom' },
]

const DEFAULT_PRESETS: RangePreset[] = ['today', 'yesterday', '7d', '30d', 'custom']

export default function DateRangeFilter({ value, onChange, presets = DEFAULT_PRESETS }: Props) {
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)
  const visiblePresets = ALL_PRESETS.filter((p) => presets.includes(p.key))

  // Keep the Custom inputs tracking whichever preset is actually active, so
  // that switching Today -> Last 30 Days -> Custom prefills the just-active
  // 30-day range instead of silently reverting to whatever was set at mount.
  useEffect(() => {
    if (value.preset !== 'custom') {
      setCustomFrom(value.from)
      setCustomTo(value.to)
    }
  }, [value.preset, value.from, value.to])

  return (
    <div className={styles.wrap}>
      <div className={styles.pills}>
        {visiblePresets.map((p) => (
          <button
            key={p.key}
            className={`${styles.pill} ${value.preset === p.key ? styles.pillActive : ''}`}
            onClick={() => {
              if (p.key === 'custom') {
                onChange(rangeForPreset('custom', customFrom, customTo))
              } else {
                onChange(rangeForPreset(p.key))
              }
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className={styles.customRow}>
          <input
            type="date"
            className={styles.dateInput}
            value={customFrom}
            max={customTo}
            onChange={(e) => { setCustomFrom(e.target.value); onChange({ preset: 'custom', from: e.target.value, to: customTo }) }}
          />
          <span className={styles.customSep}>to</span>
          <input
            type="date"
            className={styles.dateInput}
            value={customTo}
            min={customFrom}
            max={toDateStr(new Date())}
            onChange={(e) => { setCustomTo(e.target.value); onChange({ preset: 'custom', from: customFrom, to: e.target.value }) }}
          />
        </div>
      )}
    </div>
  )
}
