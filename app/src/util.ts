/*
 * Browser APIs that only exist in "secure contexts" (HTTPS or localhost) need fallbacks,
 * because the app is also opened over plain http on the LAN (e.g. http://10.0.0.26:5173).
 */

/** Unique id. crypto.randomUUID() is secure-context only; getRandomValues works everywhere. */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // RFC 4122 version 4
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Copy text. navigator.clipboard is secure-context only; fall back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  const ta = Object.assign(document.createElement('textarea'), { value: text })
  ta.style.cssText = 'position:fixed;opacity:0'
  // Inside a modal <dialog>, only the dialog's subtree is focusable/selectable.
  ;(document.querySelector('dialog[open]') ?? document.body).appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  return ok
}
