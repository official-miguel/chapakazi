import type { WordKey } from './i18n'

// The units an owner can pick for an item. They can also type their own word.
export const units: { id: string; label: WordKey }[] = [
  { id: 'pcs', label: 'unit.pcs' },
  { id: 'kg', label: 'unit.kg' },
  { id: 'g', label: 'unit.g' },
  { id: 'l', label: 'unit.l' },
  { id: 'ml', label: 'unit.ml' },
  { id: 'cups', label: 'unit.cups' },
  { id: 'pkts', label: 'unit.pkts' },
  { id: 'bunches', label: 'unit.bunches' },
  { id: 'crates', label: 'unit.crates' },
  { id: 'm', label: 'unit.m' },
]

/** The word to show for a unit: translated if it is one of ours, otherwise the owner's own word. */
export function unitName(t: (key: WordKey) => string, unit: string): string {
  const known = units.find((u) => u.id === unit)
  return known ? t(known.label) : unit
}

/** Quantities show up to 3 decimals with no trailing zeros: 2, 0.5, 1.25. */
export function formatQty(qty: number): string {
  return Number(qty.toFixed(3)).toLocaleString('en-KE', { maximumFractionDigits: 3 })
}
