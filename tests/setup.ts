import { timingSafeEqual } from 'node:crypto'

// crypto.subtle.timingSafeEqual exists in the Workers runtime only.
const subtle = globalThis.crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean }
if (!subtle.timingSafeEqual) {
  const bytes = (v: ArrayBuffer | ArrayBufferView) => (ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v))
  subtle.timingSafeEqual = (a, b) => {
    const x = bytes(a)
    const y = bytes(b)
    return x.length === y.length && timingSafeEqual(x, y)
  }
}
