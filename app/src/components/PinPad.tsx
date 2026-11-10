import { Delete } from 'lucide-react'
import { useState } from 'react'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const LENGTH = 4

/**
 * Big number keys for a 4-digit PIN.
 * `onComplete` gets the PIN once all digits are in. If it answers false, the dots clear to try again.
 */
export function PinPad({
  onComplete,
  disabled = false,
}: {
  onComplete: (pin: string) => Promise<boolean> | boolean
  disabled?: boolean
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const blocked = disabled || busy

  const press = async (digit: string) => {
    if (blocked || pin.length >= LENGTH) return
    const next = pin + digit
    setPin(next)
    if (next.length < LENGTH) return
    setBusy(true)
    try {
      const ok = await onComplete(next)
      if (!ok) setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pinpad">
      <div className="pin-dots" aria-label={`${pin.length} / ${LENGTH}`}>
        {Array.from({ length: LENGTH }, (_, i) => (
          <span key={i} className={i < pin.length ? 'pin-dot pin-dot-on' : 'pin-dot'} />
        ))}
      </div>
      <div className="pin-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" className="pin-key" disabled={blocked} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <span />
        <button type="button" className="pin-key" disabled={blocked} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="pin-key pin-key-plain"
          aria-label="Delete"
          disabled={blocked || pin.length === 0}
          onClick={() => setPin(pin.slice(0, -1))}
        >
          <Delete size={26} aria-hidden />
        </button>
      </div>
    </div>
  )
}
