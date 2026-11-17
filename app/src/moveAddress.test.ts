import { describe, expect, it } from 'vitest'
import { onOldAddress } from './moveAddress'

describe('onOldAddress: where the move notice shows', () => {
  it('shows on the old Vercel address', () => {
    expect(onOldAddress('chapakazi.vercel.app')).toBe(true)
  })
  it('never on the new address, the website, or a laptop', () => {
    expect(onOldAddress('app.chapabiz.co.ke')).toBe(false)
    expect(onOldAddress('chapabiz.co.ke')).toBe(false)
    expect(onOldAddress('localhost')).toBe(false)
  })
})
