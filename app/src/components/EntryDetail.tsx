import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { db } from '../db'
import type { EntryData, EntryLine, EntryVersion } from '../db'
import { kindClass, kindLabel, kindSign, methodLabel } from '../entryKinds'
import { useI18n } from '../i18n'
import { cancelEntry } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { formatQty, unitName } from '../units'
import { useTimeFormat } from '../useTimeFormat'
import { categoryLabel, EntryForm } from './EntryForm'
import { Sheet } from './Sheet'

/** One entry in full: what it is, who recorded it, and (for the owner) every change made to it. */
export function EntryDetail({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { t } = useI18n()
  const { dir, person, isAdmin, shops, ownsShop } = useSession()
  const { dateTime } = useTimeFormat()
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')

  const found = useLiveQuery(async () => {
    const entry = await db.entries.get(entryId)
    const versions = entry ? await db.entryVersions.where('entryId').equals(entryId).sortBy('version') : []
    const customer = entry?.customerId ? await db.customers.get(entry.customerId) : undefined
    return { entry, versions, customer }
  }, [entryId])

  if (!found?.entry || !person) return null
  const { entry, versions, customer } = found

  const nameOf = (personId: string) => dir.people.find((p) => p.id === personId)?.name ?? '?'
  const lineText = (l: EntryLine) => `${formatQty(l.qty)} ${unitName(t, l.unit)} ${l.name}`
  const describe = (d: EntryData) =>
    [
      formatKsh(d.amountCents),
      t(methodLabel[d.method]),
      d.kind === 'expense' ? t(categoryLabel(d.category)) : null,
      d.lines?.map(lineText).join(', '),
      d.note,
    ]
      .filter(Boolean)
      .join(' · ')

  const versionTitle = (v: EntryVersion) =>
    t(v.version === 1 ? 'entry.recordedBy' : v.cancelled ? 'entry.deletedBy' : 'entry.changedBy', {
      name: nameOf(v.changedBy),
    })

  if (mode === 'edit') {
    return <EntryForm kind={entry.kind} editing={entry} onClose={() => setMode('view')} />
  }

  if (mode === 'delete') {
    return (
      <Sheet title={t('entry.deleteTitle')} onClose={() => setMode('view')}>
        <p className="sheet-text">{t('entry.deleteText')}</p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            await cancelEntry(entry.id, { personId: person.id, isOwner: ownsShop(entry.businessId) })
            onClose()
          }}
        >
          {t('entry.deleteBtn')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setMode('view')}>
          {t('common.cancel')}
        </button>
      </Sheet>
    )
  }

  const shopName = shops.length > 1 ? dir.businesses.find((b) => b.id === entry.businessId)?.name : undefined

  return (
    <Sheet title={t(kindLabel[entry.kind])} onClose={onClose}>
      <p className={`detail-amount ${entry.cancelled ? 'struck' : kindClass[entry.kind]}`}>
        {kindSign[entry.kind]} {formatKsh(entry.amountCents)}
      </p>
      <p className="detail-line">
        {[
          customer?.name,
          t(methodLabel[entry.method]),
          entry.kind === 'expense' ? t(categoryLabel(entry.category)) : null,
          shopName,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {entry.lines && (
        <ul className="detail-lines">
          {entry.lines.map((l) => (
            <li key={l.id}>
              <span>{lineText(l)}</span>
              {l.totalCents > 0 && <span>{formatKsh(l.totalCents)}</span>}
            </li>
          ))}
        </ul>
      )}
      {entry.note && <p className="detail-note">{entry.note}</p>}
      <p className="detail-meta">
        {dateTime(entry.occurredAt)} · {t('entry.by', { name: nameOf(entry.createdBy) })}
        {entry.cancelled ? ` · ${t('entry.deleted')}` : entry.versions > 1 ? ` · ${t('entry.edited')}` : ''}
      </p>

      {!entry.cancelled && (
        <div className="btn-pair">
          <button type="button" className="btn btn-quiet" onClick={() => setMode('edit')}>
            <Pencil size={20} aria-hidden /> {t('entry.editBtn')}
          </button>
          <button type="button" className="btn btn-quiet ink-red" onClick={() => setMode('delete')}>
            <Trash2 size={20} aria-hidden /> {t('entry.deleteBtn')}
          </button>
        </div>
      )}

      {/* Only the owner can open the full history. */}
      {isAdmin && versions.length > 1 && (
        <section className="history">
          <h3>{t('entry.history')}</h3>
          <ol>
            {[...versions].reverse().map((v) => (
              <li key={v.id}>
                <span className="history-who">{versionTitle(v)}</span>
                <span className="history-when">{dateTime(v.changedAt)}</span>
                {!v.cancelled && <span className="history-what">{describe(v)}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </Sheet>
  )
}
