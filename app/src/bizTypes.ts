import type { BusinessType } from './db'
import type { WordKey } from './i18n'

export const bizTypes: { type: BusinessType; label: WordKey }[] = [
  { type: 'kiosk', label: 'biz.kiosk' },
  { type: 'mboga', label: 'biz.mboga' },
  { type: 'salon', label: 'biz.salon' },
  { type: 'hardware', label: 'biz.hardware' },
  { type: 'boutique', label: 'biz.boutique' },
  { type: 'chemist', label: 'biz.chemist' },
  { type: 'other', label: 'biz.other' },
]

export const bizTypeLabel = (type: BusinessType): WordKey =>
  bizTypes.find((b) => b.type === type)?.label ?? 'biz.other'
