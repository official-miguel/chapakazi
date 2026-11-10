import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, HandCoins, MessageCircle, MessageSquare, Pencil, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CustomerForm } from '../components/CustomerForm'
import { EntryDetail } from '../components/EntryDetail'
import { EntryForm } from '../components/EntryForm'
import { EntryRow } from '../components/EntryRow'
import { smsLink, whatsappLink } from '../customers'
import { db } from '../db'
import type { EntryKind } from '../db'
import { useI18n } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'

/** One customer: what they owe, their credit and payments, and one-tap reminders. */
export function CustomerScreen() {
  const { customerId = '' } = useParams()
  const { t } = useI18n()
  const { dir, shops, isAdmin } = useSession()
  const [adding, setAdding] = useState<EntryKind | null>(null)
  const [editing, setEditing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const found = useLiveQuery(async () => {
    const customer = (await db.customers.get(customerId)) ?? null
    const entries = (await db.entries.where('customerId').equals(customerId).toArray()).sort((a, b) => b.occurredAt - a.occurredAt)
    return { customer, entries }
  }, [customerId])

  if (!found) return null
  const { customer } = found
  // Not found, or belongs to a shop this view may not see.
  if (!customer || !shops.some((s) => s.id === customer.businessId)) return <Navigate to="/debts" replace />

  const entries = found.entries.filter((e) => isAdmin || !e.cancelled)
  const shopName = dir.businesses.find((b) => b.id === customer.businessId)?.name ?? ''
  const message = t('debts.reminderText', {
    name: customer.name,
    amount: formatKsh(customer.balanceCents),
    shop: shopName,
  })
  const whatsapp = customer.phone ? whatsappLink(customer.phone, message) : null
  const sms = customer.phone ? smsLink(customer.phone, message) : null
  const owes = customer.balanceCents > 0

  return (
    <>
      <Link to="/debts" className="back-link">
        <ArrowLeft size={20} aria-hidden /> {t('debts.back')}
      </Link>

      <div className="customer-head">
        <h1 className="screen-title">{customer.name}</h1>
        <button type="button" className="icon-btn" aria-label={t('debts.edit')} onClick={() => setEditing(true)}>
          <Pencil size={22} aria-hidden />
        </button>
      </div>

      <div className="total-card owed-card">
        <span className="total-label">
          {t(owes ? 'debts.owesLabel' : customer.balanceCents < 0 ? 'debts.aheadLabel' : 'debts.paidUp')}
        </span>
        <span className={`total-value ${owes ? 'ink-amber' : ''}`}>{formatKsh(Math.abs(customer.balanceCents))}</span>
        <span className="list-sub">
          {[customer.phone, customer.limitCents !== undefined ? t('debts.limitLine', { amount: formatKsh(customer.limitCents) }) : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <button type="button" className="btn btn-primary" onClick={() => setAdding('payment')}>
        <Wallet size={22} aria-hidden /> {t('entry.newPayment')}
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setAdding('credit')}>
        <HandCoins size={22} aria-hidden /> {t('entry.newCredit')}
      </button>

      {owes &&
        (whatsapp && sms ? (
          <div className="btn-pair">
            <a className="btn btn-quiet btn-small" href={whatsapp} target="_blank" rel="noreferrer">
              <MessageCircle size={20} aria-hidden /> {t('debts.whatsapp')}
            </a>
            <a className="btn btn-quiet btn-small" href={sms}>
              <MessageSquare size={20} aria-hidden /> {t('debts.sms')}
            </a>
          </div>
        ) : (
          <p className="hint-note">{t('debts.noPhone')}</p>
        ))}

      {entries.length > 0 && (
        <section className="history">
          <h3>{t('debts.history')}</h3>
          <div className="list">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} showDay onOpen={() => setOpenId(e.id)} />
            ))}
          </div>
        </section>
      )}

      {adding && <EntryForm kind={adding} forCustomer={customer} onClose={() => setAdding(null)} />}
      {editing && <CustomerForm editing={customer} onClose={() => setEditing(false)} />}
      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}
