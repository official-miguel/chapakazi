import { describe, expect, it } from 'vitest'
import { FREE_ENTRY_LIMIT, freeEntries } from './freeCount'

describe('free entries on a phone with no account', () => {
  it('allows 10 entries', () => {
    expect(FREE_ENTRY_LIMIT).toBe(10)
    expect(freeEntries(0, false, true)).toEqual({ applies: true, used: 0, left: 10, reached: false })
    expect(freeEntries(9, false, true)).toMatchObject({ left: 1, reached: false })
  })

  it('asks for an account after the 10th', () => {
    expect(freeEntries(10, false, true)).toMatchObject({ left: 0, reached: true })
    expect(freeEntries(25, false, true)).toMatchObject({ left: 0, reached: true })
  })

  it('never limits a phone with an account', () => {
    expect(freeEntries(500, true, true)).toMatchObject({ applies: false, reached: false })
  })

  it('does not flash the screen while the phone is still looking whether it is signed in', () => {
    expect(freeEntries(500, null, true).reached).toBe(false)
  })

  it('does not limit an app built without accounts (nowhere to create one)', () => {
    expect(freeEntries(500, false, false).reached).toBe(false)
  })
})
