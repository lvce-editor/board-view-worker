import {
  VirtualDomElements,
  type VirtualDomNode,
} from '@lvce-editor/virtual-dom-worker'
import type { Node } from '../VirtualDom/VirtualDom.ts'
import {
  cacheRequestUrl,
  cardImagesCache,
  openCardCache,
  readCardCache,
  writeCardCache,
} from './CardCache.ts'

const trelloAttachmentPath =
  /^\/1\/cards\/[\da-f]{24}\/attachments\/[\da-f]{24}\/(?:previews\/[\da-f]{24}\/)?download(?:\/|$)/u
export const imageMimePattern =
  /^image\/(?:png|jpeg|webp|avif|gif|bmp|x-icon|vnd\.microsoft\.icon)$/u
const imageByteLimit = 8 * 1024 * 1024
const previewHeightLimit = 420

export const trelloImageUrl = (source: string): string | undefined => {
  const url = URL.parse(source)
  if (
    !url ||
    (url.origin !== 'https://trello.com' &&
      url.origin !== 'https://api.trello.com') ||
    url.username ||
    url.password ||
    !trelloAttachmentPath.test(url.pathname)
  )
    return undefined
  url.hostname = 'api.trello.com'
  return url.href
}

const readImage = async (
  body: Readonly<ReadableStream<Uint8Array>>,
  mime: string,
): Promise<Blob | undefined> => {
  const reader = body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > imageByteLimit) {
        await reader.cancel()
        return undefined
      }
      chunks.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  return size ? new Blob(chunks, { type: mime }) : undefined
}

interface PreparedImage {
  readonly src: string
  readonly style: string
}

type AttachmentDownload = (
  url: string,
  signal: Readonly<AbortSignal>,
) => Promise<Response>

export const loadImage = async (
  src: string,
  getToken: () => Promise<string>,
  signal: Readonly<AbortSignal>,
  request: typeof fetch,
  downloadAttachment?: AttachmentDownload,
): Promise<PreparedImage | undefined> => {
  try {
    const downloadUrl = trelloImageUrl(src)
    const token = downloadUrl ? await getToken() : ''
    const cache = await openCardCache(cardImagesCache)
    const key = cache
      ? await cacheRequestUrl(downloadUrl || src, token)
      : undefined
    const cached = await readCardCache(cache, key)
    let response = cached
    if (!response) {
      try {
        response = await request(downloadUrl || src, {
          credentials: 'omit',
          ...(token && { headers: { Authorization: `Bearer ${token}` } }),
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        })
      } catch {
        // Trello's protected downloads can reject the browser's CORS request.
      }
      if (!response?.ok && downloadUrl && downloadAttachment) {
        signal.throwIfAborted()
        response = await downloadAttachment(downloadUrl, signal)
      }
    }
    const mime = response?.headers.get('content-type')?.split(';', 1)[0]
    if (
      !response?.ok ||
      !response.body ||
      !mime ||
      !imageMimePattern.test(mime)
    )
      return undefined
    const blob = await readImage(response.body, mime)
    if (!blob) return undefined
    const bitmap = await createImageBitmap(blob)
    const { height, width } = bitmap
    bitmap.close()
    signal.throwIfAborted()
    const fittedWidth = Math.min(width, (width * previewHeightLimit) / height)
    if (!cached)
      await writeCardCache(
        cache,
        key,
        new Response(blob, {
          headers: { 'Content-Type': blob.type },
        }),
      )
    const base64 = new Uint8Array(await blob.arrayBuffer()).toBase64()
    return {
      src: `data:${blob.type};base64,${base64}`,
      style: `width:min(100%,${fittedWidth}px);aspect-ratio:${width} / ${height}`,
    }
  } catch {
    return undefined
  }
}

export const loadDescriptionImages = async (
  markdown: Node,
  getToken: () => Promise<string>,
  signal: Readonly<AbortSignal>,
  request: typeof fetch,
  downloadAttachment: AttachmentDownload,
): Promise<Node> => {
  const images = new Map<string, Promise<PreparedImage | undefined>>()
  return Promise.all(
    markdown.map(async (node): Promise<VirtualDomNode> => {
      if (
        node.type !== VirtualDomElements.Img ||
        typeof node['src'] !== 'string'
      )
        return node
      const { src } = node
      let image = images.get(src)
      if (!image) {
        image = loadImage(src, getToken, signal, request, downloadAttachment)
        images.set(src, image)
      }
      return {
        ...node,
        style: 'width:100%;height:min(240px,45vh)',
        ...(await image),
      }
    }),
  )
}
