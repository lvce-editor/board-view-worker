export const cardDetailsCache = 'builtin.board-view.card-details-v1'
export const cardImagesCache = 'builtin.board-view.card-images-v1'

export const cacheRequestUrl = async (
  source: string,
  token: string,
): Promise<string | undefined> => {
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(token),
    )
    const url = URL.parse(source)
    if (!url) return undefined
    url.hash = ''
    url.searchParams.set('boardCredential', new Uint8Array(digest).toHex())
    return url.href
  } catch {
    return undefined
  }
}

export const openCardCache = async (
  name: string,
): Promise<Cache | undefined> => {
  try {
    return await globalThis.caches?.open(name)
  } catch {
    return undefined
  }
}

export const readCardCache = async (
  cache: Readonly<Cache> | undefined,
  key: string | undefined,
): Promise<Response | undefined> => {
  if (!key) return undefined
  try {
    return await cache?.match(key)
  } catch {
    return undefined
  }
}

export const writeCardCache = async (
  cache: Readonly<Cache> | undefined,
  key: string | undefined,
  response: Response,
): Promise<void> => {
  if (!key) return
  try {
    await cache?.put(key, response)
  } catch {
    // The response can still be used when Cache Storage is unavailable.
  }
}
