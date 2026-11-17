import { describe, expect, it } from 'vitest'
import { pickShop } from './shopRepair'

const shops = new Set(['shopA', 'shopB'])

describe('pickShop: which shop a shop-less record belongs to', () => {
  it('takes the first hint that is a real shop', () => {
    expect(pickShop(['', undefined, 'shopB', 'shopA'], shops, 'shopA')).toBe('shopB')
  })

  it('ignores hints that are empty or not a shop on this phone', () => {
    expect(pickShop(['', null, 'gone'], shops, 'shopA')).toBe('shopA')
  })

  it('uses the fallback only when nothing links it to a shop', () => {
    expect(pickShop([], shops, 'shopA')).toBe('shopA')
    expect(pickShop([], shops, null)).toBeNull()
  })
})
