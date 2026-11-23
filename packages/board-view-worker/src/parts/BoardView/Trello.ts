// cspell:words prefs

import type { Node } from '../VirtualDom/VirtualDom.ts'
import {
  resolveBackendConfiguration,
  type BackendConfiguration,
} from '../BackendConfiguration/BackendConfiguration.ts'
import { createBoardFavicon, type FaviconBackground } from './BoardFavicon.ts'
import {
  cacheRequestUrl,
  cardDetailsCache,
  cardImagesCache,
  openCardCache,
  readCardCache,
  writeCardCache,
} from './CardCache.ts'
import {
  normalizeActivity,
  normalizeAttachment,
  normalizeDetails,
  type CardActivity,
  type CardAttachment,
  type CardDetails,
} from './CardDetails.ts'
import { loadDescriptionImages, loadImage } from './DescriptionImages.ts'
import { loadBackgroundImage } from './LoadBackgroundImage.ts'

export interface TrelloCard {
  readonly attachmentCount?: number
  readonly commentCount?: number
  readonly coverDataUrl?: string
  readonly desc: string
  readonly id: string
  readonly idList: string
  readonly labels?: readonly TrelloLabel[]
  readonly name: string
  readonly pos: number
}

interface TrelloLabel {
  readonly color: string
  readonly id: string
  readonly name: string
}

export interface TrelloList {
  readonly id: string
  readonly name: string
  readonly pos: number
}

export interface TrelloBoardSummary {
  readonly backgroundColor?: string
  readonly backgroundGradient?: string
  readonly backgroundImage?: string
  readonly id: string
  readonly name: string
}

export interface TrelloSearchResult {
  readonly boardId?: string
  readonly boardName?: string
  readonly id: string
  readonly kind: 'board' | 'card'
  readonly listName?: string
  readonly name: string
}

export interface TrelloBoard {
  readonly backgroundColor?: string
  readonly backgroundGradient?: string
  readonly backgroundImage?: string
  readonly cards: readonly TrelloCard[]
  readonly faviconBackground?: FaviconBackground
  readonly faviconUrl?: string
  readonly id: string
  readonly lists: readonly TrelloList[]
  readonly name: string
}

export interface BoardError {
  readonly code: string
  readonly message: string
}

export class TrelloError extends Error {
  constructor(readonly details: BoardError) {
    super(details.message)
  }
}

export const isBoardPickerAccessError = (error: unknown): boolean =>
  error instanceof TrelloError &&
  [
    'TRELLO_ACCESS_DENIED',
    'TRELLO_CONNECTION_REQUIRED',
    'TRELLO_LOGIN_REQUIRED',
    'TRELLO_NOT_CONFIGURED',
  ].includes(error.details.code)

const boardError = (status: number): BoardError => {
  switch (status) {
    case 400:
    case 404:
      return {
        code: 'TRELLO_BOARD_NOT_FOUND',
        message:
          'This board could not be found. Check its URL or ID and your access to it.',
      }
    case 401:
    case 403:
      return {
        code: 'TRELLO_ACCESS_DENIED',
        message:
          'Trello denied access. Connect Trello again and check your access to this board.',
      }
    case 409:
      return {
        code: 'TRELLO_CONNECTION_REQUIRED',
        message: 'Connect Trello again to load your boards.',
      }
    case 429:
      return {
        code: 'TRELLO_RATE_LIMITED',
        message:
          'Trello is receiving too many requests. Wait a moment, then try again.',
      }
    default:
      return status >= 500
        ? {
            code: 'TRELLO_SERVER_ERROR',
            message: 'Trello is temporarily unavailable. Try again shortly.',
          }
        : {
            code: 'TRELLO_REQUEST_FAILED',
            message:
              'Unable to load this board. Check your connection and try again.',
          }
  }
}

const cardUpdateError = (status: number): BoardError => {
  if (status === 400)
    return {
      code: 'TRELLO_INVALID_CARD',
      message: 'Enter a title and description within Trello’s limits.',
    }
  return boardError(status)
}

const boardUrlPattern =
  /^(?:https:\/\/trello\.com\/b\/)([\dA-Za-z]{8})(?:\/[^?#]*)?(?:[?#].*)?$/u
export const boardIdPattern = /^(?:[\dA-Za-z]{8}|[\da-f]{24})$/u
const cardIdPattern = /^[\da-f]{24}$/u

export const parseBoardId = (input: string): string => {
  const value = input.trim()
  const match = boardUrlPattern.exec(value)
  const id = match?.[1] || value
  if (!boardIdPattern.test(id)) {
    throw new TrelloError({
      code: 'TRELLO_INVALID_BOARD',
      message:
        'Enter a Trello board URL, eight-character short ID, or full board ID.',
    })
  }
  return id
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const backgroundColorPattern =
  /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.,%\s]+\)|[a-z]{1,20})$/iu
const backgroundGradientPattern = /^linear-gradient\([a-z\d#(),.%\s-]+\)$/iu
const dangerousBackgroundGradientPattern = /\b(?:url|var|expression)\b/iu
const safeBackgroundColor = (value: unknown): string | undefined =>
  typeof value === 'string' && backgroundColorPattern.test(value)
    ? value
    : undefined
const safeBackgroundImage = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined
  const url = new URL(value)
  return url.protocol === 'https:' ? url.href : undefined
}
const safeBackgroundGradient = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  backgroundGradientPattern.test(value) &&
  value.includes(',') &&
  !dangerousBackgroundGradientPattern.test(value)
    ? value
    : undefined
const normalizeBoardBackground = (
  value: unknown,
  tile = false,
): Pick<
  TrelloBoardSummary,
  'backgroundColor' | 'backgroundGradient' | 'backgroundImage'
> => {
  if (!isRecord(value)) return {}
  const prefs = isRecord(value.prefs) ? value.prefs : undefined
  const backgroundTopColor = safeBackgroundColor(prefs?.backgroundTopColor)
  const backgroundBottomColor = safeBackgroundColor(
    prefs?.backgroundBottomColor,
  )
  const backgroundColor = safeBackgroundColor(
    prefs?.backgroundColor ?? backgroundBottomColor ?? backgroundTopColor,
  )
  const backgroundGradient =
    backgroundTopColor && backgroundBottomColor
      ? `linear-gradient(135deg, ${backgroundTopColor}, ${backgroundBottomColor})`
      : safeBackgroundGradient(prefs?.backgroundGradient ?? prefs?.background)
  const scaledBackgrounds = Array.isArray(prefs?.backgroundImageScaled)
    ? prefs.backgroundImageScaled
    : []
  const scaledBackground = tile
    ? (scaledBackgrounds.find(
        (item) =>
          isRecord(item) && typeof item.width === 'number' && item.width >= 240,
      ) ?? scaledBackgrounds.at(-1))
    : scaledBackgrounds.at(-1)
  const scaledImage = isRecord(scaledBackground)
    ? scaledBackground.url
    : undefined
  const backgroundImage = safeBackgroundImage(
    tile
      ? (scaledImage ?? prefs?.backgroundImage)
      : (prefs?.backgroundImage ?? scaledImage),
  )
  return {
    ...(backgroundColor && { backgroundColor }),
    ...(backgroundGradient && { backgroundGradient }),
    ...(backgroundImage && { backgroundImage }),
  }
}
const normalizeBoardSummary = (
  value: unknown,
): TrelloBoardSummary | undefined => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !boardIdPattern.test(value.id) ||
    typeof value.name !== 'string'
  )
    return undefined
  return {
    ...normalizeBoardBackground(value, true),
    id:
      typeof value.shortLink === 'string' &&
      boardIdPattern.test(value.shortLink)
        ? value.shortLink
        : value.id,
    name: value.name,
  }
}
const getResponseError = async (
  response: Response,
  mapError: (status: number) => BoardError,
): Promise<BoardError> => {
  if (response.status !== 403 && response.status !== 409)
    return mapError(response.status)
  try {
    const body: unknown = await response.json()
    if (
      response.status === 409 &&
      isRecord(body) &&
      body.code === 'TRELLO_COVER_CONNECTION_REQUIRED'
    ) {
      return {
        code: 'TRELLO_COVER_CONNECTION_REQUIRED',
        message: 'Connect Trello cover images to see them on this board.',
      }
    }
    if (isRecord(body) && body.code === 'TRELLO_REAUTHORIZE_REQUIRED') {
      return {
        code: 'TRELLO_REAUTHORIZE_REQUIRED',
        message: 'Reconnect Trello to allow moving cards, then try again.',
      }
    }
  } catch {
    // Keep the safe, generic access error for unreadable responses.
  }
  return mapError(response.status)
}
const isList = (value: unknown): value is TrelloList =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.pos === 'number' &&
  Number.isFinite(value.pos)
const isCard = (
  value: unknown,
): value is TrelloCard & {
  readonly badges?: unknown
  readonly coverDataUrl?: unknown
  readonly cover?: unknown
} => isList(value) && 'idList' in value && typeof value.idList === 'string'

const normalizeCount = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 0

const trelloLabelColors = new Set([
  'blue',
  'green',
  'lime',
  'orange',
  'pink',
  'purple',
  'red',
  'sky',
  'yellow',
])

const normalizeLabels = (value: unknown): readonly TrelloLabel[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((label) => {
    if (
      !isRecord(label) ||
      typeof label.id !== 'string' ||
      !label.id ||
      typeof label.name !== 'string' ||
      !label.name.trim() ||
      typeof label.color !== 'string'
    )
      return []
    return [
      {
        color: trelloLabelColors.has(label.color) ? label.color : 'unknown',
        id: label.id,
        name: label.name,
      },
    ]
  })
}

const normalizeCard = (value: unknown): TrelloCard | undefined => {
  if (!isCard(value)) return undefined
  const normalizedCoverDataUrl = value.coverDataUrl
  const badges = isRecord(value.badges) ? value.badges : undefined
  return {
    attachmentCount: normalizeCount(badges?.attachments),
    commentCount: normalizeCount(badges?.comments),
    desc: typeof value.desc === 'string' ? value.desc : '',
    id: value.id,
    idList: value.idList,
    name: value.name,
    pos: value.pos,
    ...(Array.isArray(value.labels) && {
      labels: normalizeLabels(value.labels),
    }),
    ...(typeof normalizedCoverDataUrl === 'string' &&
      normalizedCoverDataUrl.startsWith('data:image/') && {
        coverDataUrl: normalizedCoverDataUrl,
      }),
  }
}

interface TrelloStatus {
  readonly configured: boolean
  readonly connected: boolean
}

export type TrelloReturnTarget = 'board' | 'desktop' | 'editor'

const boardPickerCache = 'builtin.board-view.picker-v1'
const pickerCredentialHeader = 'X-Board-Picker-Credential'
const pickerImagePattern =
  /^data:image\/(?:png|jpeg|webp|avif|gif);base64,[A-Za-z0-9+/]+=*$/u

const normalizeCachedBoard = (
  value: unknown,
): TrelloBoardSummary | undefined => {
  const board = normalizeBoardSummary(value)
  if (!board || !isRecord(value)) return undefined
  const backgroundColor = safeBackgroundColor(value.backgroundColor)
  const backgroundGradient = safeBackgroundGradient(value.backgroundGradient)
  const backgroundImage =
    typeof value.backgroundImage === 'string' &&
    pickerImagePattern.test(value.backgroundImage)
      ? value.backgroundImage
      : undefined
  return {
    id: board.id,
    name: board.name,
    ...(backgroundColor && { backgroundColor }),
    ...(backgroundGradient && { backgroundGradient }),
    ...(backgroundImage && { backgroundImage }),
  }
}

const pickerCacheEntry = async (
  config: Readonly<BackendConfiguration>,
): Promise<
  | {
      readonly cache: Cache
      readonly credential: string
      readonly key: string
    }
  | undefined
> => {
  if (!config.baseUrl || !config.accessToken || !globalThis.caches)
    return undefined
  const baseUrl = URL.parse(config.baseUrl)
  if (!baseUrl || !['https:', 'http:'].includes(baseUrl.protocol))
    return undefined
  // Keep one snapshot per backend. A different LVCE session cannot read it.
  const key = new URL('/api/integrations/trello/board-picker-cache', baseUrl)
    .href
  const credential = await cacheRequestUrl(key, config.accessToken)
  const cache = await openCardCache(boardPickerCache)
  return cache && credential ? { cache, credential, key } : undefined
}

export interface TrelloClient {
  readonly addAttachment: (
    id: string,
    file: File,
    signal: Readonly<AbortSignal>,
  ) => Promise<CardAttachment>
  readonly addComment: (
    id: string,
    text: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<CardActivity>
  readonly archiveCard: (
    id: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<void>
  readonly authorize: (
    signal: Readonly<AbortSignal>,
    returnTarget?: TrelloReturnTarget,
    covers?: boolean,
  ) => Promise<string>
  readonly boards: (
    signal: Readonly<AbortSignal>,
  ) => Promise<readonly TrelloBoardSummary[]>
  readonly cachedBoards: (
    signal: Readonly<AbortSignal>,
  ) => Promise<readonly TrelloBoardSummary[] | undefined>
  readonly createCard: (
    idList: string,
    name: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<TrelloCard>
  readonly disconnect: (signal: Readonly<AbortSignal>) => Promise<void>
  readonly load: (
    input: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<TrelloBoard>
  readonly loadCard: (
    id: string,
    signal: Readonly<AbortSignal>,
    onCached?: (details: CardDetails) => void,
  ) => Promise<CardDetails>
  readonly loadCovers: (
    input: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<
    readonly { readonly id: string; readonly coverDataUrl: string }[]
  >
  readonly loadDescriptionImages: (
    markdown: Node,
    signal: Readonly<AbortSignal>,
  ) => Promise<Node>
  readonly moveCard: (
    cardId: string,
    listId: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<void>
  readonly search: (
    query: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<readonly TrelloSearchResult[]>
  readonly status: (
    signal: Readonly<AbortSignal>,
    covers?: boolean,
  ) => Promise<TrelloStatus>
  readonly updateCard: (
    id: string,
    name: string,
    desc: string,
    signal: Readonly<AbortSignal>,
  ) => Promise<TrelloCard>
}

export const createTrelloClient = (
  configuration: () => Promise<BackendConfiguration> = resolveBackendConfiguration,
  request: typeof fetch = fetch,
): TrelloClient => {
  let cacheRevision = 0
  let pickerRevision = 0
  const clearPickerCache = async (): Promise<void> => {
    pickerRevision++
    try {
      await globalThis.caches?.delete(boardPickerCache)
    } catch {
      // Cache Storage is best-effort.
    }
  }
  const cachedBoards = async (
    signal: Readonly<AbortSignal>,
  ): Promise<readonly TrelloBoardSummary[] | undefined> => {
    const revision = pickerRevision
    try {
      const entry = await pickerCacheEntry(await configuration())
      if (!entry || revision !== pickerRevision || signal.aborted)
        return undefined
      const response = await readCardCache(entry.cache, entry.key)
      if (response?.headers.get(pickerCredentialHeader) !== entry.credential)
        return undefined
      const data: unknown = await response.json()
      if (!Array.isArray(data) || signal.aborted || revision !== pickerRevision)
        return undefined
      const boards = data.map(normalizeCachedBoard)
      return boards.every((board) => board !== undefined) ? boards : undefined
    } catch {
      return undefined
    }
  }
  const invalidateCard = async (id: string): Promise<void> => {
    cacheRevision++
    try {
      const cache = await openCardCache(cardDetailsCache)
      await cache?.delete(`https://api.trello.com/1/cards/${id}`, {
        ignoreSearch: true,
      })
    } catch {
      // Cache Storage is best-effort.
    }
  }
  const call = async (
    path: string,
    signal: Readonly<AbortSignal>,
    method = 'GET',
    body?: unknown,
    mapError: (status: number) => BoardError = boardError,
    configOverride?: Readonly<BackendConfiguration>,
  ): Promise<{ data: unknown; baseUrl: string }> => {
    const config = configOverride ?? (await configuration())
    if (!config.baseUrl || !config.accessToken)
      throw new TrelloError({
        code: 'TRELLO_LOGIN_REQUIRED',
        message: 'Sign in to LVCE to connect Trello.',
      })
    const url = new URL(`/api/integrations/trello/${path}`, config.baseUrl)
    if (!['https:', 'http:'].includes(url.protocol))
      throw new TrelloError(boardError(0))
    const timeout = path.startsWith('boards/') ? 45_000 : 15_000
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(timeout),
    ])
    const send = (token: string): Promise<Response> =>
      request(url.href, {
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
        method,
        ...(body !== undefined && { body: JSON.stringify(body) }),
        ...(body !== undefined && {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
        redirect: 'error',
        signal: requestSignal,
      })
    let response = await send(config.accessToken)
    if (response.status === 401 && config.refreshAccessToken) {
      const token = await config.refreshAccessToken()
      if (token) response = await send(token)
    }
    if (!response.ok)
      throw new TrelloError(await getResponseError(response, mapError))
    return {
      baseUrl: config.baseUrl,
      data:
        response.status === 204
          ? undefined
          : ((await response.json()) as unknown),
    }
  }
  const status = async (
    signal: Readonly<AbortSignal>,
    covers = false,
  ): Promise<TrelloStatus> => {
    const revision = pickerRevision
    try {
      const { data } = await call(covers ? 'covers/status' : 'status', signal)
      if (
        !isRecord(data) ||
        typeof data.configured !== 'boolean' ||
        typeof data.connected !== 'boolean'
      )
        throw new TrelloError(boardError(0))
      if (
        !covers &&
        (!data.configured || !data.connected) &&
        !signal.aborted &&
        revision === pickerRevision
      )
        await clearPickerCache()
      return { configured: data.configured, connected: data.connected }
    } catch (error) {
      if (
        !covers &&
        isBoardPickerAccessError(error) &&
        !signal.aborted &&
        revision === pickerRevision
      )
        await clearPickerCache()
      throw error
    }
  }
  const getTrelloAccessToken = async (
    signal: Readonly<AbortSignal>,
    config?: Readonly<BackendConfiguration>,
  ): Promise<string> => {
    const { data } = await call(
      'token',
      signal,
      'GET',
      undefined,
      boardError,
      config,
    )
    if (!isRecord(data) || typeof data.accessToken !== 'string')
      throw new TrelloError(boardError(0))
    return data.accessToken
  }
  const trelloRequest = async (
    path: string,
    signal: Readonly<AbortSignal>,
    accessToken?: string,
    {
      body,
      cache,
      mapError = boardError,
      method,
    }: Readonly<{
      body?: Readonly<FormData>
      cache?: RequestCache
      method?: 'GET' | 'POST' | 'PUT'
      mapError?: (status: number) => BoardError
    }> = {},
  ): Promise<unknown> => {
    const token = accessToken ?? (await getTrelloAccessToken(signal))
    signal.throwIfAborted()
    const url = new URL(`/1/${path}`, 'https://api.trello.com')
    const response = await request(url.href, {
      ...(body && { body }),
      ...(cache && { cache }),
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` },
      ...(method && { method }),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    })
    if (!response.ok) throw new TrelloError(mapError(response.status))
    return response.json() as Promise<unknown>
  }
  const authorize = async (
    signal: Readonly<AbortSignal>,
    returnTarget?: TrelloReturnTarget,
    covers?: boolean,
  ): Promise<string> => {
    const { baseUrl, data } = await call(
      covers ? 'covers/connect' : 'connect',
      signal,
      'POST',
      returnTarget && { returnTarget },
    )
    const url =
      isRecord(data) && typeof data.url === 'string'
        ? URL.parse(data.url)
        : null
    if (
      !url ||
      url.origin !== new URL(baseUrl).origin ||
      url.pathname !==
        (covers ? '/auth/trello/covers/connect' : '/auth/trello/connect') ||
      !url.searchParams.get('ticket')
    )
      throw new TrelloError(boardError(0))
    return url.href
  }
  const disconnect = async (signal: Readonly<AbortSignal>): Promise<void> => {
    await call('disconnect', signal, 'POST')
    cacheRevision++
    try {
      await Promise.all([
        globalThis.caches?.delete(cardDetailsCache),
        globalThis.caches?.delete(cardImagesCache),
        clearPickerCache(),
      ])
    } catch {
      // Entries are also scoped by the Trello credential.
    }
  }
  const load = async (
    input: string,
    signal: Readonly<AbortSignal>,
  ): Promise<TrelloBoard> => {
    const id = parseBoardId(input)
    try {
      const { data } = await call(`boards/${id}`, signal)
      if (
        !isRecord(data) ||
        typeof data.id !== 'string' ||
        typeof data.name !== 'string' ||
        !Array.isArray(data.lists) ||
        !data.lists.every(isList) ||
        !Array.isArray(data.cards) ||
        data.cards.some((card) => !normalizeCard(card))
      ) {
        throw new TrelloError({
          code: 'TRELLO_INVALID_RESPONSE',
          message: 'Trello returned an unreadable board. Try again shortly.',
        })
      }
      const cards = data.cards.map((card) => normalizeCard(card))
      const prefs = isRecord(data.prefs) ? data.prefs : undefined
      const scaled = Array.isArray(prefs?.backgroundImageScaled)
        ? prefs.backgroundImageScaled
        : []
      const preview = scaled.find(
        (item) =>
          isRecord(item) && typeof item.width === 'number' && item.width >= 64,
      )
      const faviconBackground: FaviconBackground = {
        bottomColor: safeBackgroundColor(prefs?.backgroundBottomColor),
        color: safeBackgroundColor(prefs?.backgroundColor),
        image: safeBackgroundImage(
          (isRecord(preview) ? preview.url : undefined) ??
            prefs?.backgroundImage,
        ),
        tiled: prefs?.backgroundTile === true,
        topColor: safeBackgroundColor(prefs?.backgroundTopColor),
      }
      const faviconUrl = await createBoardFavicon(
        { ...faviconBackground, image: undefined },
        signal,
        request,
      )

      return {
        ...normalizeBoardBackground(data),
        cards: cards
          .filter((card): card is TrelloCard => Boolean(card))
          .toSorted((a, b) => a.pos - b.pos),
        faviconBackground,
        faviconUrl,
        id: data.id,
        lists: data.lists.toSorted((a, b) => a.pos - b.pos),
        name: data.name,
      }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof TrelloError) throw error
      throw new TrelloError(boardError(0))
    }
  }
  const loadAttachmentPreview = async (
    attachment: CardAttachment,
    token: string,
    signal: Readonly<AbortSignal>,
  ): Promise<CardAttachment> => {
    if (!attachment.previewUrl) return attachment
    const image = await loadImage(
      attachment.previewUrl,
      async () => token,
      signal,
      request,
    )
    return image ? { ...attachment, previewSrc: image.src } : attachment
  }
  const loadCard = async (
    id: string,
    signal: Readonly<AbortSignal>,
    onCached?: (details: CardDetails) => void,
  ): Promise<CardDetails> => {
    if (!cardIdPattern.test(id)) throw new TrelloError(boardError(404))
    try {
      const path = `cards/${id}?${new URLSearchParams({
        actions: 'commentCard,createCard,updateCard:idList',
        actions_limit: '100',
        attachment_fields: 'name,url,mimeType,previews',
        attachments: 'true',
        fields: 'desc',
      })}`
      const revision = cacheRevision
      const token = await getTrelloAccessToken(signal)
      signal.throwIfAborted()
      const previews = new Map<string, Promise<CardAttachment>>()
      const prepareDetails = async (
        details: CardDetails,
      ): Promise<CardDetails> => ({
        ...details,
        attachments: await Promise.all(
          details.attachments.map(async (attachment) => {
            const { previewUrl } = attachment
            if (!previewUrl) return attachment
            let pending = previews.get(previewUrl)
            if (!pending) {
              pending = loadAttachmentPreview(attachment, token, signal)
              previews.set(previewUrl, pending)
            }
            const { previewSrc } = await pending
            return previewSrc ? { ...attachment, previewSrc } : attachment
          }),
        ),
      })
      const cacheEntry = async (): Promise<{
        readonly cache: Cache | undefined
        readonly key: string | undefined
      }> => {
        const cache = await openCardCache(cardDetailsCache)
        const key = cache
          ? await cacheRequestUrl(`https://api.trello.com/1/${path}`, token)
          : undefined
        return { cache, key }
      }
      const entry = cacheEntry()
      const readCachedDetails = async (): Promise<void> => {
        if (!onCached) return
        const { cache, key } = await entry
        const cached = await readCardCache(cache, key)
        if (!cached) return
        let details: CardDetails
        try {
          details = await prepareDetails(normalizeDetails(await cached.json()))
        } catch {
          return
        }
        if (!signal.aborted && revision === cacheRevision) onCached(details)
      }
      const [result] = await Promise.allSettled([
        trelloRequest(path, signal, token, { cache: 'no-store' }),
        readCachedDetails(),
      ])
      signal.throwIfAborted()
      if (result.status === 'rejected') throw result.reason
      const data = result.value
      const details = normalizeDetails(data)
      const { cache, key } = await entry
      if (key && !signal.aborted && revision === cacheRevision) {
        await writeCardCache(cache, key, Response.json(data))
      }
      const prepared = await prepareDetails(details)
      signal.throwIfAborted()
      return prepared
    } catch (error) {
      if (signal.aborted || error instanceof TrelloError) throw error
      throw new TrelloError({
        code: 'TRELLO_CARD_DETAILS_FAILED',
        message: 'Unable to load card details. Try again.',
      })
    }
  }
  const addAttachment = async (
    id: string,
    file: File,
    signal: Readonly<AbortSignal>,
  ): Promise<CardAttachment> => {
    if (!cardIdPattern.test(id)) {
      throw new TrelloError({
        code: 'TRELLO_INVALID_CARD',
        message: 'This card could not be identified. Refresh the board.',
      })
    }
    const body = new FormData()
    body.set('file', file)
    const token = await getTrelloAccessToken(signal)
    const data = await trelloRequest(
      `cards/${id}/attachments?setCover=false`,
      signal,
      token,
      {
        body,
        mapError: (status) => {
          if (status === 400 || status === 413) {
            return {
              code: 'TRELLO_INVALID_ATTACHMENT',
              message:
                'Trello rejected this image. Check its format and size and try again.',
            }
          }
          return boardError(status)
        },
        method: 'POST',
      },
    )
    await invalidateCard(id)
    const attachment = normalizeAttachment(Array.isArray(data) ? data[0] : data)
    if (attachment) return loadAttachmentPreview(attachment, token, signal)
    throw new TrelloError({
      code: 'TRELLO_INVALID_RESPONSE',
      message:
        'Trello accepted the upload. Reopen the card to check its attachments before retrying.',
    })
  }
  const addComment = async (
    id: string,
    text: string,
    signal: Readonly<AbortSignal>,
  ): Promise<CardActivity> => {
    if (!cardIdPattern.test(id)) {
      throw new TrelloError({
        code: 'TRELLO_INVALID_CARD',
        message: 'This card could not be identified. Refresh the board.',
      })
    }
    const data = await trelloRequest(
      `cards/${id}/actions/comments?${new URLSearchParams({ text })}`,
      signal,
      undefined,
      {
        mapError: (status) => {
          if (status === 400 || status === 414) {
            return {
              code: 'TRELLO_INVALID_COMMENT',
              message:
                'Trello rejected this comment. Check its length and try again.',
            }
          }
          if (status === 404) {
            return {
              code: 'TRELLO_CARD_NOT_FOUND',
              message: 'This card could not be found. Refresh the board.',
            }
          }
          return boardError(status)
        },
        method: 'POST',
      },
    )
    await invalidateCard(id)
    const activity = normalizeActivity(data)
    if (isRecord(data) && data.type === 'commentCard' && activity)
      return activity
    throw new TrelloError({
      code: 'TRELLO_INVALID_RESPONSE',
      message:
        'Trello accepted the comment. Reopen the card to check the activity before retrying.',
    })
  }
  const loadCovers = async (
    input: string,
    signal: Readonly<AbortSignal>,
  ): Promise<
    readonly { readonly id: string; readonly coverDataUrl: string }[]
  > => {
    const id = parseBoardId(input)
    const { data } = await call(`boards/${id}/covers`, signal)
    if (!Array.isArray(data)) return []
    return data.filter(
      (
        cover,
      ): cover is { readonly id: string; readonly coverDataUrl: string } =>
        isRecord(cover) &&
        typeof cover.id === 'string' &&
        typeof cover.coverDataUrl === 'string' &&
        cover.coverDataUrl.startsWith('data:image/'),
    )
  }
  const updateCard = async (
    id: string,
    name: string,
    desc: string,
    signal: Readonly<AbortSignal>,
  ): Promise<TrelloCard> => {
    if (!cardIdPattern.test(id)) {
      throw new TrelloError({
        code: 'TRELLO_INVALID_CARD',
        message:
          'This card could not be saved. Refresh the board and try again.',
      })
    }
    try {
      const { data } = await call(
        `cards/${id}`,
        signal,
        'PUT',
        { desc, name },
        cardUpdateError,
      )
      const updatedCard = isRecord(data) ? normalizeCard(data) : undefined
      if (
        !updatedCard ||
        !isRecord(data) ||
        data.id !== id ||
        typeof data.desc !== 'string'
      ) {
        throw new TrelloError({
          code: 'TRELLO_INVALID_RESPONSE',
          message: 'Trello returned an unreadable card. Refresh the board.',
        })
      }
      await invalidateCard(id)
      return { ...updatedCard, desc: data.desc }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof TrelloError) throw error
      throw new TrelloError(boardError(0))
    }
  }
  const boards = async (
    signal: Readonly<AbortSignal>,
  ): Promise<readonly TrelloBoardSummary[]> => {
    const revision = ++pickerRevision
    try {
      const config = await configuration()
      const token = await getTrelloAccessToken(signal, config)
      const data = await trelloRequest(
        `members/me/boards?${new URLSearchParams({
          fields: 'id,name,prefs,shortLink',
          filter: 'open',
        })}`,
        signal,
        token,
      )
      if (
        !Array.isArray(data) ||
        data.some((board) => !normalizeBoardSummary(board))
      )
        throw new TrelloError({
          code: 'TRELLO_INVALID_RESPONSE',
          message:
            'Trello returned an unreadable board list. Try again shortly.',
        })
      const summaries = data
        .map(normalizeBoardSummary)
        .filter((board): board is TrelloBoardSummary => Boolean(board))
        .toSorted(
          (a: Readonly<TrelloBoardSummary>, b: Readonly<TrelloBoardSummary>) =>
            a.name.localeCompare(b.name),
        )
      const prepared = await Promise.all(
        summaries.map(async ({ backgroundImage, ...board }) => {
          const image = backgroundImage
            ? await loadBackgroundImage(backgroundImage, signal, request)
            : undefined
          return { ...board, ...(image && { backgroundImage: image }) }
        }),
      )
      signal.throwIfAborted()
      const entry = await pickerCacheEntry(config)
      if (entry && !signal.aborted && revision === pickerRevision) {
        await writeCardCache(
          entry.cache,
          entry.key,
          Response.json(prepared, {
            headers: { [pickerCredentialHeader]: entry.credential },
          }),
        )
      }
      return prepared
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof TrelloError) {
        if (revision === pickerRevision && isBoardPickerAccessError(error))
          await clearPickerCache()
        throw error
      }
      throw new TrelloError({
        code: 'TRELLO_REQUEST_FAILED',
        message:
          'Unable to load your boards. Check your connection and try again.',
      })
    }
  }
  const search = async (
    query: string,
    signal: Readonly<AbortSignal>,
  ): Promise<readonly TrelloSearchResult[]> => {
    const value = query.trim()
    if (!value) return []
    try {
      const data = await trelloRequest(
        `search?${new URLSearchParams({
          board_fields: 'name,shortLink',
          boards_limit: '10',
          card_board: 'true',
          card_fields: 'name,idBoard,idList,closed',
          card_list: 'true',
          cards_limit: '20',
          modelTypes: 'boards,cards',
          partial: 'true',
          query: value,
        })}`,
        signal,
      )
      if (
        !isRecord(data) ||
        !Array.isArray(data.boards) ||
        !Array.isArray(data.cards)
      )
        throw new TrelloError({
          code: 'TRELLO_INVALID_RESPONSE',
          message:
            'Trello returned unreadable search results. Try again shortly.',
        })
      const boardResults: TrelloSearchResult[] = data.boards.flatMap((item) => {
        const board = normalizeBoardSummary(item)
        return board
          ? [{ id: board.id, kind: 'board' as const, name: board.name }]
          : []
      })
      const cardResults: TrelloSearchResult[] = data.cards.flatMap((item) => {
        if (
          !isRecord(item) ||
          item.closed === true ||
          typeof item.id !== 'string' ||
          !cardIdPattern.test(item.id) ||
          typeof item.name !== 'string'
        )
          return []
        const board = isRecord(item.board) ? item.board : undefined
        const list = isRecord(item.list) ? item.list : undefined
        const directBoardId = item.idBoard
        const nestedBoardId = board?.id
        let boardId: string | undefined
        if (
          typeof directBoardId === 'string' &&
          boardIdPattern.test(directBoardId)
        )
          boardId = directBoardId
        else if (
          typeof nestedBoardId === 'string' &&
          boardIdPattern.test(nestedBoardId)
        )
          boardId = nestedBoardId
        if (!boardId) return []
        return [
          {
            boardId,
            boardName: typeof board?.name === 'string' ? board.name : '',
            id: item.id,
            kind: 'card' as const,
            ...(typeof list?.name === 'string' && { listName: list.name }),
            name: item.name,
          },
        ]
      })
      return [...boardResults, ...cardResults]
    } catch (error) {
      if (signal.aborted || error instanceof TrelloError) throw error
      throw new TrelloError({
        code: 'TRELLO_REQUEST_FAILED',
        message:
          'Unable to search Trello. Check your connection and try again.',
      })
    }
  }
  const createCard = async (
    idList: string,
    name: string,
    signal: Readonly<AbortSignal>,
  ): Promise<TrelloCard> => {
    try {
      const { data } = await call('cards', signal, 'POST', {
        idList,
        name: name.trim(),
      })
      const card = normalizeCard(data)
      if (!card || card.idList !== idList)
        throw new Error('Invalid card response')
      return card
    } catch (error) {
      if (signal.aborted) throw error
      if (
        error instanceof TrelloError &&
        [
          'TRELLO_ACCESS_DENIED',
          'TRELLO_CONNECTION_REQUIRED',
          'TRELLO_REAUTHORIZE_REQUIRED',
        ].includes(error.details.code)
      )
        throw new TrelloError({
          code: 'TRELLO_WRITE_DENIED',
          message:
            'Trello denied access to add this card. If you have permission to add cards to this board, reconnect Trello and try again. Your title has been kept.',
        })
      throw new TrelloError({
        code: 'TRELLO_CREATE_FAILED',
        message:
          'The card could not be confirmed. Refresh the board before trying again to avoid duplicates. Your title has been kept.',
      })
    }
  }
  const archiveCard = async (
    id: string,
    signal: Readonly<AbortSignal>,
  ): Promise<void> => {
    if (!cardIdPattern.test(id)) {
      throw new TrelloError({
        code: 'TRELLO_INVALID_CARD',
        message: 'This card could not be identified. Refresh the board.',
      })
    }
    const data = await trelloRequest(
      `cards/${id}?closed=true&fields=closed`,
      signal,
      undefined,
      {
        mapError: (status) =>
          status === 404
            ? {
                code: 'TRELLO_CARD_NOT_FOUND',
                message: 'This card could not be found. Refresh the board.',
              }
            : boardError(status),
        method: 'PUT',
      },
    )
    await invalidateCard(id)
    if (!isRecord(data) || data.id !== id || data.closed !== true) {
      throw new TrelloError({
        code: 'TRELLO_INVALID_RESPONSE',
        message:
          'Trello did not confirm the archive. Refresh the board to check the card.',
      })
    }
  }
  const moveCard = async (
    cardId: string,
    listId: string,
    signal: Readonly<AbortSignal>,
  ): Promise<void> => {
    if (!cardIdPattern.test(cardId) || !cardIdPattern.test(listId)) {
      throw new TrelloError({
        code: 'TRELLO_INVALID_MOVE',
        message:
          'This card or list could not be identified. Refresh the board.',
      })
    }
    await call(`cards/${cardId}/list/${listId}`, signal, 'PUT')
    await invalidateCard(cardId)
  }
  return {
    addAttachment,
    addComment,
    archiveCard,
    authorize,
    boards,
    cachedBoards,
    createCard,
    disconnect,
    load,
    loadCard,
    loadCovers,
    loadDescriptionImages(markdown, signal): Promise<Node> {
      let token: Promise<string> | undefined
      return loadDescriptionImages(
        markdown,
        () => (token ??= getTrelloAccessToken(signal)),
        signal,
        request,
      )
    },
    moveCard,
    search,
    status,
    updateCard,
  }
}

export const trelloClient = createTrelloClient()
