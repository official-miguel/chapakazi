// PINs are scrambled ("hashed") before saving, so the real PIN is never stored anywhere.

const ITERATIONS = 100_000

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  )
  return toBase64(new Uint8Array(bits))
}

export async function hashPin(pin: string): Promise<{ pinSalt: string; pinHash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { pinSalt: toBase64(salt), pinHash: await derive(pin, salt) }
}

export async function verifyPin(pin: string, pinSalt: string, pinHash: string): Promise<boolean> {
  return (await derive(pin, fromBase64(pinSalt))) === pinHash
}
