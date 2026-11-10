import { useLiveQuery } from 'dexie-react-hooks'
import { Eye } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { EntryDetail } from '../components/EntryDetail'
import { db } from '../db'
import { useI18n } from '../i18n'
import { markAlertSeen } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useTimeFormat } from '../useTimeFormat'

/** Owner only: edits by workers that deserve a second look. Tapping one opens the entry's history. */
export function AlertsScreen() {
  const { t } = useI18n()
  const { dir, shops } = useSession()
  const { dateTime } = useTimeFormat()
  const [openId, setOpenId] = useState<string | null>(null)

  const shopIds = shops.map((s) => s.id)
  const alerts = useLiveQuery(
    async () => (await db.alerts.where('businessId').anyOf(shopIds).toArray()).sort((a, b) => b.at - a.at),
    [shopIds.join()],
  )

  return (
    <>
      <h1 className="screen-title">{t('alerts.title')}</h1>

      {alerts &&
        (alerts.length === 0 ? (
          <EmptyState icon={<Eye size={40} />} title={t('alerts.empty')} hint={t('alerts.emptyHint')} />
        ) : (
          <div className="list">
            {alerts.map((a) => {
              const who = dir.people.find((p) => p.id === a.byPersonId)?.name ?? '?'
              const shop = shops.length > 1 ? dir.businesses.find((b) => b.id === a.businessId)?.name : undefined
              return (
                <button
                  key={a.id}
                  type="button"
                  className="list-row"
                  onClick={() => {
                    setOpenId(a.entryId)
                    if (!a.seenAt) void markAlertSeen(a.id)
                  }}
                >
                  <span className="list-main">
                    <span className="list-title">
                      {a.kind === 'late_delete'
                        ? t('alerts.lateDelete', { from: formatKsh(a.fromCents ?? 0) })
                        : t(a.kind === 'over_limit' ? 'alerts.overLimit' : 'alerts.lowered', {
                            from: formatKsh(a.fromCents ?? 0),
                            to: formatKsh(a.toCents ?? 0),
                          })}
                    </span>
                    <span className="list-sub">{[who, dateTime(a.at), shop].filter(Boolean).join(' · ')}</span>
                  </span>
                  {!a.seenAt && <span className="tag tag-amber">{t('alerts.new')}</span>}
                </button>
              )
            })}
          </div>
        ))}

      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}
