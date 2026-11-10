import type { EntryKind, PayMethod } from './db'
import type { WordKey } from './i18n'

// How each kind of entry is named and coloured, in one place.

export const kindLabel: Record<EntryKind, WordKey> = {
  sale: 'entry.sale',
  expense: 'entry.expense',
  credit: 'entry.credit',
  payment: 'entry.payment',
}

export const methodLabel: Record<PayMethod, WordKey> = {
  cash: 'entry.cash',
  mpesa: 'entry.mpesa',
  credit: 'entry.onCredit',
}

/** Money in is green with a plus, money out is red with a minus. Credit is amber: no money has moved yet. */
export const kindSign: Record<EntryKind, string> = { sale: '+', payment: '+', expense: '−', credit: '' }

export const kindClass: Record<EntryKind, string> = {
  sale: 'money-in',
  payment: 'money-in',
  expense: 'money-out',
  credit: 'ink-amber',
}
