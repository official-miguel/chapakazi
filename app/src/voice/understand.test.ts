import { describe, expect, it } from 'vitest'
import type { Customer, Item } from '../db'
import { understand } from './understand'

const item = (id: string, name: string, unit: string, priceCents?: number) =>
  ({ id, businessId: 'b', name, unit, priceCents, tracked: true }) as Item
const bread = item('bread', 'Bread', 'pcs', 6000)
const sugar = item('sugar', 'Sugar', 'kg', 15000)
const mary = { id: 'mary', name: 'Mary' } as Customer
const shop = { items: [bread, sugar], customers: [mary] }

describe('price of one, times how many', () => {
  it.each([
    '6 pieces of bread at 300',
    '6pieces of bread at 300',
    'bread 6 pieces @ 300',
    'six pieces of bread at three hundred',
    'bread 6 at 300 each',
    'mkate sita mia tatu kila moja',
    'vipande sita vya mkate kwa mia tatu kila kimoja',
  ])('%s -> 6 Bread, KSh 1,800', (text) => {
    const d = understand(text, shop)
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0]).toMatchObject({ item: bread, qty: 6, unitPriceCents: 30000, totalCents: 180000 })
    expect(d.amountCents).toBe(180000)
    expect(d.sure).toBe(true)
  })

  it('works when the item is not in the shop yet, and keeps the 6 in the note', () => {
    const d = understand('6 pieces at 300', shop)
    expect(d.amountCents).toBe(180000)
    expect(d.note).toBe('6 pieces × 300')
    expect(d.sure).toBe(true)
  })

  it('keeps the name of an unknown thing too', () => {
    const d = understand('chapati 6 pieces at 30', shop)
    expect(d.amountCents).toBe(18000)
    expect(d.note).toBe('Chapati · 6 pieces × 30')
  })

  it('a big count with a price of one', () => {
    const d = understand('mkate thelathini at 50', shop)
    expect(d.lines[0]).toMatchObject({ qty: 30, totalCents: 150000 })
  })

  it('on credit', () => {
    const d = understand('Mary amechukua mkate 6 at 300 kwa deni', shop)
    expect(d.kind).toBe('credit')
    expect(d.customer).toBe(mary)
    expect(d.amountCents).toBe(180000)
  })

  it('"at 300" alone is just the amount', () => {
    const d = understand('bread at 300', shop)
    expect(d.lines[0]).toMatchObject({ qty: 1, totalCents: 30000 })
    expect(d.amountCents).toBe(30000)
  })
})

describe('what already worked', () => {
  it('sukari kilo mbili mia tatu cash', () => {
    const d = understand('sukari kilo mbili mia tatu cash', shop)
    expect(d.lines[0]).toMatchObject({ item: sugar, qty: 2 })
    expect(d.amountCents).toBe(30000)
  })
  it('mkate mbili', () => {
    const d = understand('mkate mbili', shop)
    expect(d.lines[0]).toMatchObject({ qty: 2, totalCents: 12000 })
    expect(d.amountCents).toBe(12000)
  })
  it('sukari ya hamsini', () => {
    const d = understand('sukari ya hamsini', shop)
    expect(d.lines[0].totalCents).toBe(5000)
  })
  it('nimelipa stima mia tano mpesa', () => {
    const d = understand('nimelipa stima mia tano mpesa', shop)
    expect(d).toMatchObject({ kind: 'expense', category: 'electricity', amountCents: 50000, method: 'mpesa' })
  })
})
