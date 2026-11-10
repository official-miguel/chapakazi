import { HandCoins, Receipt, ShoppingBag, Wallet } from 'lucide-react'
import type { Entry, EntryKind } from '../db'
import { kindClass, kindLabel, kindSign, methodLabel } from '../entryKinds'
import { useI18n } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useTimeFormat } from '../useTimeFormat'
import { categoryLabel } from './EntryForm'

const icons: Record<EntryKind, typeof Receipt> = {
  sale: ShoppingBag,
  expense: Receipt,
  credit: HandCoins,
  payment: Wallet,
}

/** One line in a list of entries. Tapping it opens the full entry. */
export function EntryRow({
  entry,
  customerName,
  showDay = false,
  onOpen,
}: {
  entry: Entry
  /** Shown for credit and payment entries when the list mixes customers. */
  customerName?: string
  showDay?: boolean
  onOpen: () => void
}) {
  const { t } = useI18n()
  const { dir, shops } = useSession()
  const { time, dateTime } = useTimeFormat()

  const Icon = icons[entry.kind]
  const what =
    entry.note ||
    entry.lines?.map((l) => l.name).join(', ') ||
    (entry.kind === 'expense' ? t(categoryLabel(entry.category)) : t(kindLabel[entry.kind]))
  const title = customerName ? `${customerName} · ${what}` : what
  const who = dir.people.find((p) => p.id === entry.createdBy)?.name
  const shop = shops.length > 1 ? dir.businesses.find((b) => b.id === entry.businessId)?.name : undefined
  const sub = [showDay ? dateTime(entry.occurredAt) : time(entry.occurredAt), t(methodLabel[entry.method]), who, shop]
    .filter(Boolean)
    .join(' · ')

  return (
    <button type="button" className={entry.cancelled ? 'list-row row-cancelled' : 'list-row'} onClick={onOpen}>
      <span className="row-icon" aria-hidden>
        <Icon size={22} />
      </span>
      <span className="list-main">
        <span className="list-title">{title}</span>
        <span className="list-sub">{sub}</span>
      </span>
      <span className="row-end">
        <span className={`row-amount ${entry.cancelled ? 'struck' : kindClass[entry.kind]}`}>
          {kindSign[entry.kind]} {formatKsh(entry.amountCents)}
        </span>
        {entry.cancelled ? (
          <span className="tag tag-red">{t('entry.deleted')}</span>
        ) : (
          entry.versions > 1 && <span className="tag">{t('entry.edited')}</span>
        )}
      </span>
    </button>
  )
}
