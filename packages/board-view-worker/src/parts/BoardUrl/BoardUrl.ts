const boardPathRegex = /(?:^|\/)(?:boards|board)\/?$/

export type BoardHash =
  | { readonly id: string; readonly type: 'board' }
  | { readonly type: 'invalid' | 'none' }

export const getUrl = (href: string): URL | undefined =>
  URL.canParse(href) ? new URL(href) : undefined

export const getBoardHash = (id: string): string => `#${encodeURIComponent(id)}`

export const isBoardPath = (pathname: string): boolean =>
  boardPathRegex.test(pathname)

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
    const id = decodeURIComponent(url.hash.slice(1))
    return id ? { id, type: 'board' } : { type: 'invalid' }
  } catch {
    return { type: 'invalid' }
  }
}
