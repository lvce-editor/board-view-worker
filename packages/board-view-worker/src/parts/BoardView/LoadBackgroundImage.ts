const imageContentTypePattern = /^image\/(?:png|jpeg|webp|avif|gif)$/u

export const loadBackgroundImage = async (
  url: string,
  signal: Readonly<AbortSignal>,
  request: typeof fetch,
): Promise<string | undefined> => {
  try {
    const response = await request(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    })
    const mime = response.headers.get('content-type')?.split(';', 1)[0]
    if (!response.ok || !mime || !imageContentTypePattern.test(mime))
      return undefined
    const reader = response.body?.getReader()
    if (!reader) return undefined
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (size + value.length > 1_000_000) {
          await reader.cancel()
          return undefined
        }
        chunks.push(value)
        size += value.length
      }
    } finally {
      reader.releaseLock()
    }
    if (!size) return undefined
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return `data:${mime};base64,${bytes.toBase64()}`
  } catch {
    signal.throwIfAborted()
    return undefined
  }
}
