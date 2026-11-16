import { describe, expect, it } from 'vitest'
import { kenyaTimestamp, normalizePhone, parseStkCallback, parseStkQuery, stkPassword } from './daraja'

describe('normalizePhone', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0112345678', '254112345678'],
    ['+254 712 345 678', '254712345678'],
    ['254712345678', '254712345678'],
    ['712-345-678', '254712345678'],
  ])('%s becomes %s', (input, out) => expect(normalizePhone(input)).toBe(out))

  it.each(['', '12345', '0812345678', '25471234567', 'abc0712345678'])('refuses %s', (input) =>
    expect(normalizePhone(input)).toBeNull())
})

describe('kenyaTimestamp', () => {
  it('is in Kenyan time (UTC+3)', () => {
    expect(kenyaTimestamp(new Date('2026-11-16T22:05:09Z'))).toBe('20261117010509')
  })
})

describe('stkPassword', () => {
  it('is base64 of short code + passkey + timestamp', () => {
    expect(atob(stkPassword('174379', 'abc', '20261116120000'))).toBe('174379abc20261116120000')
  })
})

// The shape Safaricom sends (from Daraja's documentation).
const paid = {
  Body: {
    stkCallback: {
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: 'ws_CO_191220191020363925',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 1199.0 },
          { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
          { Name: 'TransactionDate', Value: 20191219102115 },
          { Name: 'PhoneNumber', Value: 254708374149 },
        ],
      },
    },
  },
}

describe('parseStkCallback', () => {
  it('reads a successful payment', () => {
    expect(parseStkCallback(paid)).toEqual({
      checkoutRequestId: 'ws_CO_191220191020363925',
      merchantRequestId: '29115-34620561-1',
      resultCode: 0,
      resultDesc: 'The service request is processed successfully.',
      receipt: 'NLJ7RT61SV',
      amountKes: 1199,
      phone: '254708374149',
    })
  })

  it('reads a cancelled prompt (no metadata)', () => {
    const r = parseStkCallback({
      Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: 'ws_CO_1', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } },
    })
    expect(r?.resultCode).toBe(1032)
    expect(r?.receipt).toBeNull()
    expect(r?.amountKes).toBeNull()
  })

  it('ignores things that are not callbacks', () => {
    expect(parseStkCallback(null)).toBeNull()
    expect(parseStkCallback({})).toBeNull()
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'x', ResultCode: 'zero' } } })).toBeNull()
  })

  it('drops a receipt that does not look like an M-Pesa code', () => {
    const odd = structuredClone(paid)
    odd.Body.stkCallback.CallbackMetadata.Item[1].Value = "x'; drop table--"
    expect(parseStkCallback(odd)?.receipt).toBeNull()
  })
})

describe('parseStkQuery', () => {
  it('reads a final answer', () => {
    expect(parseStkQuery({ ResultCode: '1032', ResultDesc: 'Request cancelled by user' })).toEqual({
      resultCode: 1032, resultDesc: 'Request cancelled by user',
    })
  })
  it('says "not yet" while the customer has not answered', () => {
    expect(parseStkQuery({ errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' })).toBeNull()
  })
})
