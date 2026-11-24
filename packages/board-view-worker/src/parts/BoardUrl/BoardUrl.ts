const boardPathRegex = /(?:^|\/)(?:boards|board)\/?$/

export type BoardHash =
  | { readonly id: string; readonly type: 'board' }
  | { readonly cardId: string; readonly id: string; readonly type: 'card' }
  | { readonly type: 'invalid' | 'none' }

export const getUrl = (href: string): URL | undefined =>
  URL.canParse(href) ? new URL(href) : undefined

export const getBoardHash = (id: string, cardId?: string): string => {
  const boardHash = `#${encodeURIComponent(id)}`
  return cardId ? `${boardHash}/card/${encodeURIComponent(cardId)}` : boardHash
}

export const isBoardPath = (pathname: string): boolean =>
  boardPathRegex.test(pathname)

export const getIdePath = (pathname: string): string =>
  pathname.replace(boardPathRegex, '/')

export const getBoardPath = (href: string, assetDir: string): string => {
  const currentUrl = new URL(href)
  const assetPath = new URL(assetDir, currentUrl).pathname
  const pathPrefix = assetPath.slice(0, assetPath.lastIndexOf('/'))
  return pathPrefix ? `${pathPrefix}/boards` : '/boards'
}

export const parseBoardHash = (href: string): BoardHash => {
  const url = getUrl(href)
  if (!url || !isBoardPath(url.pathname) || !url.hash) return { type: 'none' }
  try {
    const segments = url.hash.slice(1).split('/')
    const id = decodeURIComponent(segments[0])
    if (segments.length > 1) {
      if (
        !id ||
        segments.length !== 3 ||
        segments[1] !== 'card' ||
        !segments[2]
      )
        return { type: 'invalid' }
      return { cardId: decodeURIComponent(segments[2]), id, type: 'card' }
    }
    return id ? { id, type: 'board' } : { type: 'invalid' }
  } catch {
    return { type: 'invalid' }
  }
}
