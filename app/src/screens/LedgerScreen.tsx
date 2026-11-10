import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { EntryDetail } from '../components/EntryDetail'
import { EntryRow } from '../components/EntryRow'
import { useI18n } from '../i18n'
import { addDays, entriesBetween, startOfDay, totals } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useCustomers } from '../useCustomers'
import { useTimeFormat } from '../useTimeFormat'

/** Every entry for one day, newest first, with arrows to look at earlier days. */
export function LedgerScreen() {
  const { t } = useI18n()
  const { shops, isAdmin } = useSession()
  const { byId: customers } = useCustomers()
  const { day: formatDay } = useTimeFormat()
  const today = startOfDay(Date.now())
  const [day, setDay] = useState(today)
  const [openId, setOpenId] = useState<string | null>(null)

  const shopIds = shops.map((s) => s.id)
  const all = useLiveQuery(() => entriesBetween(shopIds, day, addDays(day, 1)), [shopIds.join(), day])
  // Deleted entries stay visible to the owner only.
  const entries = all?.filter((e) => isAdmin || !e.cancelled)
  const sums = totals(entries ?? [])

  const dayLabel =
    day === today ? t('day.today') : day === addDays(today, -1) ? t('day.yesterday') : formatDay(day)

  return (
    <>
      <h1 className="screen-title">{t('nav.ledger')}</h1>

      <div className="day-nav">
        <button type="button" className="icon-btn" aria-label={t('day.previous')} onClick={() => setDay(addDays(day, -1))}>
          <ChevronLeft size={26} aria-hidden />
        </button>
        <span className="day-label">{dayLabel}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('day.next')}
          disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronRight size={26} aria-hidden />
        </button>
      </div>

      {entries && entries.length > 0 && (
        <p className="day-sums">
          <span className="money-in">+ {formatKsh(sums.inCents)}</span>
          <span className="money-out">− {formatKsh(sums.outCents)}</span>
        </p>
      )}

      {entries &&
        (entries.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={40} />}
            title={day === today ? t('ledger.empty') : t('ledger.dayEmpty')}
            hint={t('ledger.emptyHint')}
          />
        ) : (
          <div className="list">
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                customerName={e.customerId ? customers.get(e.customerId)?.name : undefined}
                onOpen={() => setOpenId(e.id)}
              />
            ))}
          </div>
        ))}

      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}
