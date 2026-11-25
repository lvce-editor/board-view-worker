import {
  executeCommand,
  getPreference,
  setPreference,
  writeClipboardText,
  type View,
  type ViewContext,
  type ViewEvent,
  type VirtualDomViewInstance,
} from '@lvce-editor/api'
import type {
  CardDetailAction,
  CardDetailFocus,
  CardDetailFrame,
  ConnectCardDetail,
  DispatchCardDetail,
} from '../CardDetail/CardDetailProtocol.ts'
import type { Node } from '../VirtualDom/VirtualDom.ts'
import type { CardDetails } from './CardDetails.ts'
import {
  getBoardHash,
  getUrl,
  isBoardPath,
  parseBoardHash,
} from '../BoardUrl/BoardUrl.ts'
import { connectCardDetail } from '../CardDetail/CardDetailWorker.ts'
import { getWorkspaceTitle } from '../WorkspaceTitle/WorkspaceTitle.ts'
import { createBoardFavicon } from './BoardFavicon.ts'
import { createSession, type BoardSession } from './BoardSession.ts'
import { renderDescriptionMarkdown } from './DescriptionMarkdownWorker.ts'
import { render, type BoardState } from './Render.ts'
import {
  renderCardLoading,
  renderCardStartupError,
} from './RenderCardLoading.ts'
import {
  boardIdPattern,
  isBoardPickerAccessError,
  isBoardUnavailable,
  trelloClient,
  parseBoardId,
  TrelloError,
  type TrelloBoard,
  type TrelloBoardSummary,
  type TrelloCard,
  type TrelloList,
  type TrelloReturnTarget,
} from './Trello.ts'

export const viewId = 'chat2.views.board'
const connectionsPreference = 'chat2.connectedBoardIds'
const connectionNamesPreference = 'chat2.connectedBoardNames'
const hostedBoardUrl = 'https://lvce-editor.github.io/board-view-worker/boards/'
const hostedBoardPath = new URL(hostedBoardUrl).pathname
const hostedHomePath = new URL('..', hostedBoardUrl).pathname
const boardRefreshInterval = 15_000
const isCardTitleBlur = (event: Readonly<ViewEvent>): boolean =>
  event.type === 'blur' && event.name === 'board-card-title'

const cardDetailEvents = new Set([
  'board-card-actions',
  'board-card-archive',
  'board-card-cancel',
  'board-card-copy-link',
  'board-card-details-retry',
  'board-card-move',
  'board-card-save-retry',
  'board-card-title-edit',
  'board-comment-text',
  'board-description-edit',
  'board-description-retry',
  'board-post-comment',
  'edit-card-desc',
  'edit-card-name',
])

const isCardDetailEvent = (name: string | undefined): boolean =>
  Boolean(
    name && (cardDetailEvents.has(name) || name.startsWith('board-card-move:')),
  )

export interface BoardHost {
  readonly addAttachment: typeof trelloClient.addAttachment
  readonly addComment: typeof trelloClient.addComment
  readonly archiveCard: typeof trelloClient.archiveCard
  readonly authorize: typeof trelloClient.authorize
  readonly boards: typeof trelloClient.boards
  readonly cachedBoard: typeof trelloClient.cachedBoard
  readonly cachedBoards: typeof trelloClient.cachedBoards
  readonly createCard: typeof trelloClient.createCard
  readonly createFavicon: typeof createBoardFavicon
  readonly execute: typeof executeCommand
  readonly load: typeof trelloClient.load
  readonly loadCard: typeof trelloClient.loadCard
  readonly loadDescriptionImages: typeof trelloClient.loadDescriptionImages
  readonly moveCard: typeof trelloClient.moveCard
  readonly read: typeof getPreference
  readonly renderDescriptionMarkdown: (text: string) => Promise<Node>
  readonly revoke: typeof trelloClient.disconnect
  readonly search: typeof trelloClient.search
  readonly session: BoardSession
  readonly status: typeof trelloClient.status
  readonly updateCard: typeof trelloClient.updateCard
  readonly write: typeof setPreference
  readonly writeClipboardText: typeof writeClipboardText
}
interface BoardDragHandlers {
  readonly handleBoardDragEnd: () => void
  readonly handleBoardDragOver: (name: string) => void
  readonly handleBoardDragStart: (name: string) => void
  readonly handleBoardDrop: (name: string) => void
}
type LoadPrefetchedCard = (
  showCached: (details: CardDetails) => void,
) => Promise<CardDetails | undefined>

interface CardPrefetch {
  readonly abort: () => void
  readonly completedAt: number | undefined
  readonly consume: LoadPrefetchedCard
  readonly id: string
}

interface BoardViewInstance extends VirtualDomViewInstance, BoardDragHandlers {
  readonly handleCardPaste: (
    files: unknown,
    targetName?: unknown,
    selectionStart?: unknown,
    selectionEnd?: unknown,
  ) => void
  readonly handleCardPointerDown: (
    name: string,
    button: number,
    primary: boolean,
  ) => void
  readonly handleDialogKeyDown: (
    key: unknown,
    targetName?: unknown,
    ctrlKey?: unknown,
    isComposing?: unknown,
  ) => void
  readonly handleDialogOverlayClick: (className: unknown) => void
}
const getMoveTarget = (
  board: BoardState['board'],
  draggedCardId: string | undefined,
  listName: string,
):
  | {
      readonly board: TrelloBoard
      readonly card: TrelloCard
      readonly destination: TrelloList
    }
  | undefined => {
  if (!board || !draggedCardId) return undefined
  const destinationId = listName.startsWith('board-list:')
    ? listName.slice('board-list:'.length)
    : ''
  const card = board.cards.find(({ id }) => id === draggedCardId)
  const destination = board.lists.find(({ id }) => id === destinationId)
  if (!card || !destination || card.idList === destination.id) return undefined
  return { board, card, destination }
}
const isReauthorizationRequired = (error: unknown): boolean =>
  error instanceof TrelloError &&
  error.details.code === 'TRELLO_REAUTHORIZE_REQUIRED'
const defaultHost: BoardHost = {
  addAttachment: trelloClient.addAttachment,
  addComment: trelloClient.addComment,
  archiveCard: trelloClient.archiveCard,
  authorize: trelloClient.authorize,
  boards: trelloClient.boards,
  cachedBoard: trelloClient.cachedBoard,
  cachedBoards: trelloClient.cachedBoards,
  createCard: trelloClient.createCard,
  createFavicon: createBoardFavicon,
  execute: executeCommand,
  load: trelloClient.load,
  loadCard: trelloClient.loadCard,
  loadDescriptionImages: trelloClient.loadDescriptionImages,
  moveCard: trelloClient.moveCard,
  read: getPreference,
  renderDescriptionMarkdown,
  revoke: trelloClient.disconnect,
  search: trelloClient.search,
  session: createSession(),
  status: trelloClient.status,
  updateCard: trelloClient.updateCard,
  write: setPreference,
  writeClipboardText,
}

const getHrefFromHost = async (host: BoardHost): Promise<string> => {
  try {
    const href = await host.execute('Layout.getHref')
    return typeof href === 'string' ? href : ''
  } catch {
    return ''
  }
}

const getTrelloReturnTarget = (
  href: string,
): TrelloReturnTarget | undefined => {
  const url = getUrl(href)
  if (!url) return undefined
  if (url.protocol === 'lvce:' || url.protocol === 'lvce-oss:') return 'desktop'
  if (url.origin !== 'https://lvce-editor.github.io') return undefined
  const [, app] = url.pathname.split('/')
  if (app === 'board-view-worker') return 'board'
  if (app === 'lvce-editor') return 'editor'
  return undefined
}

const setBoardHash = async (
  host: BoardHost,
  hash: string,
  isCurrent?: () => boolean,
): Promise<void> => {
  try {
    const href = await getHrefFromHost(host)
    const url = getUrl(href)
    if (!url || isCurrent?.() === false) return
    if (isBoardPath(url.pathname)) {
      await host.execute('Layout.setHash', hash)
    } else if (
      hash &&
      url.pathname === hostedHomePath &&
      (url.protocol === 'https:' || url.protocol === 'http:')
    ) {
      await host.execute(
        'Layout.setPathName',
        `${hostedBoardPath}${url.search}${hash}`,
      )
    }
  } catch {
    // Older editor builds do not expose URL commands.
  }
}

const getProviderAction = (
  name: string | undefined,
): 'trello' | 'providers' | undefined => {
  if (name === 'board-provider:trello') return 'trello'
  if (name === 'board-providers') return 'providers'
  return undefined
}

const readConnectedIds = async (
  read: BoardHost['read'],
): Promise<readonly string[]> => {
  try {
    const saved = await read(connectionsPreference)
    if (Array.isArray(saved))
      return saved.filter(
        (id): id is string => typeof id === 'string' && boardIdPattern.test(id),
      )
  } catch {
    // The connection form remains usable when settings cannot be read.
  }
  return []
}

const readConnectedNames = async (
  read: BoardHost['read'],
  ids: readonly string[],
): Promise<Readonly<Record<string, string>>> => {
  const names: Record<string, string> = {}
  try {
    const saved = await read(connectionNamesPreference)
    if (typeof saved === 'object' && saved !== null) {
      for (const [id, name] of Object.entries(saved)) {
        if (!ids.includes(id) || typeof name !== 'string' || !name.trim())
          continue
        names[id] = name
      }
    }
  } catch {
    // Boards without a saved name can still be opened by ID.
  }
  return names
}

export const createInstance = async (
  context?: ViewContext,
  host: BoardHost = defaultHost,
  connectDetail: ConnectCardDetail = connectCardDetail,
): Promise<BoardViewInstance> => {
  const connectedIds = await readConnectedIds(host.read)
  const connectedNames = await readConnectedNames(host.read, connectedIds)
  const savedState = context?.state
  const href = await getHrefFromHost(host)
  const boardHash = parseBoardHash(href)
  const urlBoardId =
    (boardHash.type === 'board' || boardHash.type === 'card') &&
    boardIdPattern.test(boardHash.id)
      ? boardHash.id
      : ''
  const urlCardId =
    urlBoardId && boardHash.type === 'card' ? boardHash.cardId : undefined
  const savedId =
    typeof savedState === 'object' &&
    savedState !== null &&
    'boardId' in savedState &&
    typeof savedState.boardId === 'string'
      ? savedState.boardId
      : ''
  const initialId =
    urlBoardId ||
    (connectedIds.includes(savedId) ? savedId : connectedIds[0] || '')
  const connection = host.session.get(initialId)
  let state: BoardState = {
    accountConnected: Boolean(connection),
    authorizationUrl: undefined,
    authorizing: false,
    board: connection?.board,
    boardId: initialId,
    boards: [],
    connectedIds,
    connectedNames,
    error: undefined,
    loading: false,
    providerSelected: false,
  }
  let generation = 0
  let controller: AbortController | undefined
  let boardRefreshController: AbortController | undefined
  let boardRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let faviconController: AbortController | undefined
  let searchController: AbortController | undefined
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchGeneration = 0
  let dragMutationController: AbortController | undefined
  let cardPrefetch: CardPrefetch | undefined
  let disposed = false
  let preferenceWrite = Promise.resolve(true)
  const saveBoardPreferences = (ids?: readonly string[]): Promise<boolean> => {
    const { connectedNames } = state
    const write = async (
      previous: Readonly<Promise<boolean>>,
    ): Promise<boolean> => {
      await previous
      try {
        if (ids) await host.write(connectionsPreference, ids)
        await host.write(connectionNamesPreference, connectedNames)
        return true
      } catch {
        return false
      }
    }
    preferenceWrite = write(preferenceWrite)
    return preferenceWrite
  }
  const rememberBoardNames = (
    boards: readonly TrelloBoardSummary[],
  ): boolean => {
    const { connectedIds, connectedNames } = state
    const names = { ...connectedNames }
    let changed = false
    for (const key of connectedIds) {
      const name = boards.find(
        ({ fullId, id }) => id === key || fullId === key,
      )?.name
      if (!name?.trim() || names[key] === name) continue
      names[key] = name
      changed = true
    }
    if (changed) state = { ...state, connectedNames: names }
    return changed
  }
  const syncFavicon = async (faviconUrl: string): Promise<void> => {
    try {
      await host.execute('WindowTitle.setFavicon', faviconUrl)
    } catch {
      // Older editor builds do not expose favicon commands.
    }
  }
  const syncTab = async (title: string, faviconUrl = ''): Promise<void> => {
    await syncFavicon(faviconUrl)
    await host.execute('WindowTitle.set', title)
  }
  const restoreTab = async (): Promise<void> => {
    // Clear before the asynchronous workspace lookup so an old view's
    // disposal cannot later clear a newly opened board's icon.
    await syncFavicon('')
    await host.execute('WindowTitle.set', await getWorkspaceTitle(host.execute))
  }
  const { board: initialBoard } = state
  await syncTab(initialBoard?.name || 'Boards', initialBoard?.faviconUrl)
  let detailFocus: CardDetailFocus = {
    focusCardActions: false,
    focusCardTitle: false,
    focusComment: false,
    focusDescription: false,
    focusEditor: false,
  }
  let detailFrame: CardDetailFrame | undefined
  let detailSession:
    | {
        readonly dispatch: DispatchCardDetail
        readonly controller: AbortController
        pending: number
      }
    | undefined
  let detailStartupFailed = false
  let focusNewCard = false
  let focusRestore = false
  let focusRestoreName = 'board-overview'
  const notify = async (): Promise<void> => {
    if (!disposed) await context?.requestRerender()
  }
  const disposeDetail = (): void => {
    const session = detailSession
    detailSession = undefined
    detailFrame = undefined
    detailStartupFailed = false
    if (session) {
      session.controller.abort()
      void Promise.try(() => session.dispatch({ type: 'dispose' })).catch(
        () => {
          // The worker may already be shutting down.
        },
      )
    }
  }
  const sendDetail = async (action: CardDetailAction): Promise<void> => {
    const session = detailSession
    if (!session) return
    session.pending++
    try {
      await session.dispatch(action)
    } catch {
      if (session !== detailSession) return
      disposeDetail()
      detailStartupFailed = true
      void notify()
    } finally {
      session.pending--
    }
  }
  const clearDrag = async (): Promise<void> => {
    const { draggedCardId, dropTargetId } = state
    if (!draggedCardId && !dropTargetId) return
    state = { ...state, draggedCardId: undefined, dropTargetId: undefined }
    await notify()
  }
  const cancelCardPrefetch = (): void => {
    cardPrefetch?.abort()
    cardPrefetch = undefined
  }
  const cancel = (preserveDraft = false): void => {
    const { cardDraft } = state
    generation++
    disposeDetail()
    cancelCardPrefetch()
    controller?.abort()
    boardRefreshController?.abort()
    boardRefreshController = undefined
    faviconController?.abort()
    dragMutationController?.abort()
    state = {
      ...state,
      authorizationUrl: undefined,
      authorizing: false,
      authorizingCovers: false,
      cardDraft: preserveDraft && !cardDraft?.saving ? cardDraft : undefined,
      discoveringBoards: false,
      editingCardId: undefined,
      listActionsId: undefined,
      loading: false,
    }
  }
  const syncBoardHash = (): Promise<void> => {
    const { boardId, editingCardId } = state
    return setBoardHash(host, getBoardHash(boardId, editingCardId), () => {
      const { boardId: currentBoardId, editingCardId: currentCardId } = state
      return (
        !disposed &&
        currentBoardId === boardId &&
        currentCardId === editingCardId
      )
    })
  }
  const closeEditor = (): void => {
    disposeDetail()
    const { editingCardId } = state
    if (editingCardId) {
      focusRestoreName = `board-card:${editingCardId}`
      focusRestore = !focusRestore
    }
    state = { ...state, editingCardId: undefined }
    if (editingCardId) void syncBoardHash()
  }
  const refreshFavicon = (
    id: string,
    board: TrelloBoard,
    requestGeneration: number,
  ): void => {
    const { faviconBackground } = board
    if (
      !faviconBackground?.image ||
      disposed ||
      requestGeneration !== generation
    )
      return
    faviconController?.abort()
    const requestController = new AbortController()
    faviconController = requestController
    void host
      .createFavicon(faviconBackground, requestController.signal)
      .then(async (faviconUrl) => {
        if (
          disposed ||
          requestController.signal.aborted ||
          requestGeneration !== generation
        )
          return
        const { board: current } = state
        if (!current) return
        const updated = { ...current, faviconUrl }
        host.session.set(id, { board: updated })
        state = { ...state, board: updated }
        await syncFavicon(faviconUrl)
      })
      .catch(() => {
        // Keep the immediate color icon if the optional photo cannot be loaded.
      })
      .finally(() => {
        if (faviconController === requestController)
          faviconController = undefined
      })
  }
  const boardLoadError = (error: unknown): void => {
    const connectionRequired =
      error instanceof TrelloError &&
      error.details.code === 'TRELLO_CONNECTION_REQUIRED'
    state = {
      ...state,
      error:
        error instanceof TrelloError
          ? error.details
          : {
              code: 'TRELLO_REQUEST_FAILED',
              message:
                'Unable to load this board. Check your connection and try again.',
            },
      loading: false,
      ...(connectionRequired && {
        accountConnected: false,
        providerSelected: true,
      }),
    }
  }
  const discardBoard = async (error: unknown): Promise<void> => {
    const { boardId } = state
    cancel()
    host.session.remove(boardId)
    state = { ...state, board: undefined, editingCardId: undefined }
    boardLoadError(error)
    await syncTab('Boards')
    await notify()
  }
  const showConnectedBoard = async (
    id: string,
    board: TrelloBoard,
    requestGeneration: number,
    cached: boolean,
    cardId?: string,
  ): Promise<void> => {
    const isCurrent = (): boolean =>
      !disposed && requestGeneration === generation
    const { connectedIds } = state
    const card = board.cards.find((item) => item.id === cardId)
    await setBoardHash(
      host,
      getBoardHash(id, cached ? cardId : card?.id),
      isCurrent,
    )
    if (!isCurrent()) return
    host.session.set(id, { board })
    const ids = [...new Set([...connectedIds, id])]
    state = {
      ...state,
      accountConnected: true,
      board,
      boardId: id,
      connectedIds: ids,
      loading: false,
    }
    rememberBoardNames([{ fullId: board.id, id, name: board.name }])
    const saved = saveBoardPreferences(ids)
    if (card) showCard(card)
    await notify()
    if (!isCurrent()) return
    await syncTab(board.name, board.faviconUrl)
    refreshFavicon(id, board, requestGeneration)
    if (cached && isCurrent())
      void refreshBoard(true, card ? undefined : cardId)
    if (!(await saved) && isCurrent()) {
      state = {
        ...state,
        error: {
          code: 'BOARD_SETTINGS_FAILED',
          message:
            'The board is connected, but its details could not be saved. Reconnect it next time.',
        },
      }
      await notify()
    }
  }
  const connect = async (cardId?: string, useCache = false): Promise<void> => {
    const { board, boardId } = state
    cancel(Boolean(board))
    const requestGeneration = generation
    const isCurrent = (): boolean =>
      !disposed && requestGeneration === generation
    controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(45_000),
    ])
    state = { ...state, error: undefined, loading: true }
    try {
      const cached = useCache
        ? await host.cachedBoard(boardId, signal)
        : undefined
      if (!isCurrent()) return
      const board = cached ?? (await host.load(boardId, signal))
      if (!isCurrent()) return
      await showConnectedBoard(
        parseBoardId(boardId),
        board,
        requestGeneration,
        Boolean(cached),
        cardId,
      )
    } catch (error) {
      if (!isCurrent()) return
      if (isBoardUnavailable(error)) {
        await discardBoard(error)
        return
      }
      boardLoadError(error)
      const { board: activeBoard } = state
      if (!activeBoard) await syncFavicon('')
      await notify()
    }
  }
  const moveCard = async (listName: string): Promise<void> => {
    const { board: currentBoard, draggedCardId } = state
    const target = getMoveTarget(currentBoard, draggedCardId, listName)
    if (!target) {
      await clearDrag()
      return
    }
    const { board, card, destination } = target
    const { accountConnected, boardId } = state
    const nextBoard = {
      ...board,
      cards: board.cards.map((item) =>
        item.id === card.id ? { ...item, idList: destination.id } : item,
      ),
    }
    const requestGeneration = generation
    const requestController = new AbortController()
    dragMutationController = requestController
    state = {
      ...state,
      board: nextBoard,
      draggedCardId: undefined,
      dropTargetId: undefined,
      error: undefined,
      loading: true,
    }
    await notify()
    try {
      await host.moveCard(card.id, destination.id, requestController.signal)
      if (!disposed && generation === requestGeneration) {
        host.session.set(boardId, { board: nextBoard })
        state = { ...state, loading: false }
      }
    } catch (error) {
      if (!disposed && generation === requestGeneration) {
        state = {
          ...state,
          accountConnected: isReauthorizationRequired(error)
            ? false
            : Boolean(accountConnected),
          board,
          error:
            error instanceof TrelloError
              ? error.details
              : {
                  code: 'TRELLO_MOVE_FAILED',
                  message:
                    'This card could not be moved. Your board is unchanged; try again.',
                },
          loading: false,
        }
      }
    }
    if (dragMutationController === requestController)
      dragMutationController = undefined
    await notify()
  }
  const disconnect = async (): Promise<void> => {
    cancel()
    const requestGeneration = generation
    const { boardId, connectedIds, connectedNames } = state
    host.session.remove(boardId)
    const ids = connectedIds.filter((id) => id !== boardId)
    const names = Object.fromEntries(
      Object.entries(connectedNames).filter(
        ([id]: readonly [string, string]) => id !== boardId,
      ),
    )
    state = {
      ...state,
      board: undefined,
      boardId: '',
      connectedIds: ids,
      connectedNames: names,
      error: undefined,
      loading: false,
      providerSelected: false,
      searchQuery: '',
    }
    const saved = saveBoardPreferences(ids)
    await setBoardHash(host, '')
    await syncTab('Boards')
    if (!(await saved) && !disposed && requestGeneration === generation) {
      state = {
        ...state,
        error: {
          code: 'BOARD_SETTINGS_FAILED',
          message: 'The saved board could not be removed. Try again.',
        },
      }
    }
  }
  const restoreConnection = async (id: string): Promise<void> => {
    const requestGeneration = generation
    const selected = host.session.get(id)
    if (!selected) {
      await syncTab('Boards')
      return
    }
    state = { ...state, accountConnected: true, board: selected.board }
    await syncTab(selected.board.name, selected.board.faviconUrl)
    refreshFavicon(id, selected.board, requestGeneration)
  }
  const connectionError = (error: unknown): void => {
    state = {
      ...state,
      authorizationUrl: undefined,
      authorizing: false,
      error:
        error instanceof TrelloError
          ? error.details
          : {
              code: 'TRELLO_CONNECTION_FAILED',
              message: 'Unable to connect Trello. Try again.',
            },
      loading: false,
      ...(isBoardPickerAccessError(error) && {
        accountConnected: false,
        boards: [],
      }),
    }
  }
  const loadBoards = async (
    signal: Readonly<AbortSignal>,
    requestGeneration: number,
  ): Promise<void> => {
    if (disposed || generation !== requestGeneration) return
    const boards = await host.boards(signal)
    if (disposed || generation !== requestGeneration) return
    if (rememberBoardNames(boards)) void saveBoardPreferences()
    const { boardId } = state
    state = {
      ...state,
      boardId: boards.some((board) => board.id === boardId) ? boardId : '',
      boards,
      discoveringBoards: false,
      loading: false,
    }
  }
  const restoreCachedBoards = async (
    signal: Readonly<AbortSignal>,
  ): Promise<void> => {
    const boards = await host.cachedBoards(signal)
    if (signal.aborted || !boards) return
    state = {
      ...state,
      accountConnected: true,
      boards,
      loading: false,
      providerSelected: true,
    }
    await notify()
  }
  const showDisconnectedAccount = (
    configured: boolean,
    providerSelected: boolean,
  ): void => {
    state = {
      ...state,
      accountConnected: false,
      boards: [],
      error: configured
        ? undefined
        : {
            code: 'TRELLO_NOT_CONFIGURED',
            message:
              'The server administrator needs to configure Trello OAuth.',
          },
      loading: false,
      providerSelected,
    }
  }
  const checkAccount = async (automatic = false): Promise<void> => {
    cancel()
    const { boards, providerSelected } = state
    const requestGeneration = generation
    controller = new AbortController()
    const { signal } = controller
    state = {
      ...state,
      discoveringBoards: true,
      error: undefined,
      loading: boards.length === 0,
    }
    try {
      if (automatic) await restoreCachedBoards(signal)
      if (disposed || generation !== requestGeneration) return
      const result = await host.status(
        AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      )
      if (disposed || generation !== requestGeneration) return
      if (result.connected && result.configured) {
        state = { ...state, accountConnected: true, providerSelected: true }
        await loadBoards(signal, requestGeneration)
        if (disposed || generation !== requestGeneration) return
      } else {
        showDisconnectedAccount(
          result.configured,
          !automatic && providerSelected,
        )
      }
    } catch (error) {
      if (disposed || generation !== requestGeneration) return
      connectionError(error)
      const { accountConnected } = state
      if (automatic && !accountConnected)
        state = { ...state, providerSelected: false }
    }
    state = { ...state, discoveringBoards: false }
    await notify()
  }
  const waitForAuthorization = async (
    signal: Readonly<AbortSignal>,
    returnTarget: TrelloReturnTarget | undefined,
    covers?: boolean,
  ): Promise<void> => {
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          signal.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, 2000)
        signal.addEventListener('abort', finish, { once: true })
      })
      signal.throwIfAborted()
      const { connected } = covers
        ? await host.status(signal, true)
        : await host.status(signal)
      signal.throwIfAborted()
      if (connected) {
        if (returnTarget === 'desktop') {
          try {
            await host.execute('Layout.focusWindow')
          } catch {
            // Older editor builds can still finish connecting.
          }
        }
        return
      }
    }
    signal.throwIfAborted()
  }
  const cancelAuthorization = (): void => {
    const { board, cardDraft } = state
    cancel(Boolean(board))
    if (cardDraft) focusNewCard = !focusNewCard
  }
  const authorize = async (reconnectCard = false): Promise<void> => {
    const { authorizing, cardDraft, loading } = state
    if (authorizing || loading) return
    if (reconnectCard && cardDraft?.error?.code !== 'TRELLO_WRITE_DENIED')
      return
    cancel(reconnectCard)
    const requestGeneration = generation
    controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(600_000),
    ])
    state = { ...state, authorizing: true, error: undefined }
    try {
      const returnTarget = getTrelloReturnTarget(await getHrefFromHost(host))
      signal.throwIfAborted()
      const url = await host.authorize(signal, returnTarget)
      if (disposed || generation !== requestGeneration) return
      state = { ...state, authorizationUrl: url }
      await notify()
      await waitForAuthorization(signal, returnTarget)
      if (disposed || generation !== requestGeneration) return
      state = {
        ...state,
        accountConnected: true,
        authorizationUrl: undefined,
        authorizing: false,
        discoveringBoards: !reconnectCard,
        loading: !reconnectCard,
      }
      if (reconnectCard && cardDraft) {
        state = { ...state, cardDraft: { ...cardDraft, error: undefined } }
        focusNewCard = !focusNewCard
      } else {
        await notify()
        await loadBoards(signal, requestGeneration)
      }
      await notify()
    } catch (error) {
      if (disposed || generation !== requestGeneration) return
      connectionError(error)
      if (reconnectCard && cardDraft) {
        const { error: failure } = state
        state = {
          ...state,
          cardDraft: {
            ...cardDraft,
            error: {
              code: 'TRELLO_WRITE_DENIED',
              message: failure?.message || 'Unable to reconnect Trello.',
            },
          },
          error: undefined,
        }
      }
      await notify()
    }
  }
  const authorizeCovers = async (): Promise<void> => {
    const { authorizing, board, loading } = state
    if (authorizing || loading || !board) return
    cancel(true)
    const requestGeneration = generation
    controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(600_000),
    ])
    state = {
      ...state,
      authorizing: true,
      authorizingCovers: true,
      error: undefined,
    }
    try {
      const returnTarget = getTrelloReturnTarget(await getHrefFromHost(host))
      signal.throwIfAborted()
      const url = await host.authorize(signal, returnTarget, true)
      if (disposed || generation !== requestGeneration) return
      state = { ...state, authorizationUrl: url }
      await notify()
      await waitForAuthorization(signal, returnTarget, true)
      if (disposed || generation !== requestGeneration) return
      await connect()
    } catch {
      if (disposed || generation !== requestGeneration) return
      state = {
        ...state,
        authorizationUrl: undefined,
        authorizing: false,
        authorizingCovers: false,
        error: {
          code: 'TRELLO_COVER_CONNECTION_FAILED',
          message: 'Unable to connect Trello images. Try again.',
        },
      }
      await notify()
    }
  }
  const revoke = async (): Promise<void> => {
    cancel()
    const requestGeneration = generation
    controller = new AbortController()
    state = { ...state, error: undefined, loading: true }
    try {
      await host.revoke(
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      )
      if (disposed || generation !== requestGeneration) return
      const { connectedIds } = state
      for (const id of connectedIds) host.session.remove(id)
      state = {
        ...state,
        accountConnected: false,
        board: undefined,
        boardId: '',
        boards: [],
        loading: false,
        providerSelected: true,
      }
      await syncTab('Boards')
    } catch (error) {
      if (disposed || generation !== requestGeneration) return
      connectionError(error)
    }
    await notify()
  }
  const createCard = async (): Promise<void> => {
    const { authorizing, board, boardId, cardDraft, editingCardId, loading } =
      state
    if (
      !board ||
      editingCardId ||
      !cardDraft ||
      cardDraft.saving ||
      authorizing ||
      loading ||
      !cardDraft.title.trim() ||
      cardDraft.title.trim().length > 16_384 ||
      board.lists.every((list) => list.id !== cardDraft.listId)
    )
      return
    const requestGeneration = generation
    controller = new AbortController()
    state = {
      ...state,
      cardDraft: { ...cardDraft, error: undefined, saving: true },
    }
    try {
      const card = await host.createCard(
        cardDraft.listId,
        cardDraft.title.trim(),
        AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
      )
      if (disposed || generation !== requestGeneration) return
      const updated = {
        ...board,
        cards: [...board.cards, card].toSorted((a, b) => a.pos - b.pos),
      }
      host.session.set(boardId, { board: updated })
      state = { ...state, board: updated, cardDraft: undefined }
    } catch (error) {
      if (disposed || generation !== requestGeneration) return
      state = {
        ...state,
        cardDraft: {
          ...cardDraft,
          error:
            error instanceof TrelloError
              ? error.details
              : {
                  code: 'TRELLO_CREATE_FAILED',
                  message:
                    'The card could not be confirmed. Refresh the board before trying again. Your title has been kept.',
                },
          saving: false,
        },
      }
    }
    await notify()
  }
  const openNewCard = (listId: string): void => {
    const { authorizing, board, cardDraft, editingCardId, loading } = state
    if (
      !editingCardId &&
      !loading &&
      !authorizing &&
      !cardDraft?.saving &&
      board?.lists.some((list) => list.id === listId)
    ) {
      if (cardDraft?.listId !== listId)
        state = { ...state, cardDraft: { listId, saving: false, title: '' } }
      focusNewCard = !focusNewCard
    }
  }
  const cancelCard = (): void => {
    const { cardDraft } = state
    if (!cardDraft?.saving) state = { ...state, cardDraft: undefined }
  }
  const startSearch = (value: string): void => {
    searchGeneration++
    searchController?.abort()
    if (searchTimer) clearTimeout(searchTimer)
    if (!value.trim()) return
    const currentGeneration = searchGeneration
    searchTimer = setTimeout(() => {
      searchController = new AbortController()
      void host
        .search(
          value,
          AbortSignal.any([
            searchController.signal,
            AbortSignal.timeout(45_000),
          ]),
        )
        .then((searchResults) => {
          if (disposed || currentGeneration !== searchGeneration) return
          state = { ...state, searchLoading: false, searchResults }
          void notify()
        })
        .catch((error: unknown) => {
          if (
            disposed ||
            currentGeneration !== searchGeneration ||
            searchController?.signal.aborted
          )
            return
          state = {
            ...state,
            searchError:
              error instanceof TrelloError
                ? error.details
                : {
                    code: 'TRELLO_SEARCH_FAILED',
                    message: 'Unable to search Trello. Try again.',
                  },
            searchLoading: false,
          }
          void notify()
        })
    }, 250)
  }
  const dismissCardAfterBlur = (): void => {
    const { cardDraft } = state
    if (!cardDraft || cardDraft.saving || cardDraft.title || cardDraft.error)
      return
    cancelCard()
    void notify()
  }
  const handleInput = (name: string | undefined, value: string): void => {
    const { cardDraft } = state
    switch (name) {
      case 'board-card-title':
        if (cardDraft && !cardDraft.saving)
          state = { ...state, cardDraft: { ...cardDraft, title: value } }
        break
      case 'board-id':
        cancel()
        state = { ...state, boardId: value, error: undefined, loading: false }
        break
      case 'board-search':
        const {
          searchError: _previousSearchError,
          ...stateWithoutSearchError
        } = state
        state = {
          ...stateWithoutSearchError,
          searchLoading: Boolean(value.trim()),
          searchQuery: value,
          searchResults: [],
        }
        startSearch(value)
        break
    }
  }
  const prefetchCard = (name: string): void => {
    const { board, editingCardId, loading } = state
    if (disposed || editingCardId || loading || !name.startsWith('board-card:'))
      return
    const id = name.slice('board-card:'.length)
    if (!board?.cards.some((card) => card.id === id)) return
    cancelCardPrefetch()
    const requestController = new AbortController()
    let cached: CardDetails | undefined
    let completedAt: number | undefined
    let showCached: ((details: CardDetails) => void) | undefined
    const load = async (): Promise<CardDetails | undefined> => {
      try {
        return await host.loadCard(id, requestController.signal, (details) => {
          cached = details
          showCached?.(details)
        })
      } catch {
        return undefined
      } finally {
        completedAt = performance.now()
      }
    }
    const result = load()
    cardPrefetch = {
      abort: (): void => requestController.abort(),
      get completedAt(): number | undefined {
        return completedAt
      },
      consume(show): Promise<CardDetails | undefined> {
        showCached = show
        if (cached) show(cached)
        return result
      },
      id,
    }
  }
  const showCard = (
    card: TrelloCard,
    prefetch?: Readonly<CardPrefetch>,
  ): void => {
    disposeDetail()
    const { board, boardId } = state
    if (!board) return
    state = { ...state, editingCardId: card.id }
    const controller = new AbortController()
    if (prefetch)
      controller.signal.addEventListener('abort', prefetch.abort, {
        once: true,
      })
    const { signal } = controller
    let loadPrefetched = prefetch?.consume
    const dispatch = connectDetail({
      addAttachment: (file) => host.addAttachment(card.id, file, signal),
      addComment: (text) => host.addComment(card.id, text, signal),
      applyChange(changes): void {
        const { board: current } = state
        if (!current || signal.aborted) return
        const cards = changes
          ? current.cards.map((item) =>
              item.id === card.id ? { ...item, ...changes } : item,
            )
          : current.cards.filter(({ id }) => id !== card.id)
        const nextBoard = { ...current, cards }
        host.session.set(boardId, { board: nextBoard })
        state = { ...state, board: nextBoard }
      },
      archiveCard: () => host.archiveCard(card.id, signal),
      close(archived): void {
        if (signal.aborted) return
        if (archived) {
          const { searchResults = [] } = state
          state = {
            ...state,
            searchResults: searchResults.filter(
              (result) => result.kind !== 'card' || result.id !== card.id,
            ),
          }
        }
        closeEditor()
        if (archived) focusRestoreName = 'board-overview'
        cancel()
        void notify()
      },
      async copyCardLink(): Promise<void> {
        const currentUrl = getUrl(await getHrefFromHost(host))
        signal.throwIfAborted()
        const url =
          currentUrl &&
          ['https:', 'http:'].includes(currentUrl.protocol) &&
          isBoardPath(currentUrl.pathname)
            ? currentUrl
            : getUrl(hostedBoardUrl)
        if (!url) throw new Error('Card URL unavailable')
        url.hash = getBoardHash(boardId, card.id)
        await host.writeClipboardText(url.href)
      },
      loadCard(): Promise<CardDetails | undefined> {
        const load = loadPrefetched
        loadPrefetched = undefined
        const showCached = (details: CardDetails): void => {
          if (!signal.aborted) void sendDetail({ details, type: 'cached' })
        }
        return load
          ? load(showCached)
          : host.loadCard(card.id, signal, showCached)
      },
      loadDescriptionImages: (markdown) =>
        host.loadDescriptionImages(markdown, signal),
      moveCard: (listId) => host.moveCard(card.id, listId, signal),
      publish(frame): void {
        if (signal.aborted) return
        detailFrame = frame
        detailFocus = frame.focus
        void notify()
      },
      renderDescriptionMarkdown: host.renderDescriptionMarkdown,
      updateCard: (name, desc) =>
        host.updateCard(
          card.id,
          name,
          desc,
          AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        ),
    })
    detailSession = { controller, dispatch, pending: 0 }
    void sendDetail({
      card,
      focus: detailFocus,
      lists: board.lists,
      type: 'open',
    })
  }
  const restoreLinkedCard = (board: TrelloBoard, cardId: string): void => {
    const card = board.cards.find((item) => item.id === cardId)
    if (card) showCard(card)
    else void syncBoardHash()
  }
  const canRefreshBoard = ({
    accountConnected,
    board,
    cardDraft,
    draggedCardId,
    editingCardId,
    loading,
  }: BoardState): boolean =>
    Boolean(
      accountConnected &&
      board &&
      !cardDraft?.saving &&
      !draggedCardId &&
      !loading &&
      (!editingCardId ||
        (detailFrame && !detailFrame.busy && !detailSession?.pending)),
    )
  const refreshBoard = async (
    fromCache = false,
    linkedCardId?: string,
  ): Promise<void> => {
    const { board, boardId } = state
    if (
      disposed ||
      !board ||
      boardRefreshController ||
      (!fromCache && !canRefreshBoard(state))
    )
      return
    const requestController = new AbortController()
    boardRefreshController = requestController
    const { signal } = requestController
    try {
      const fresh = await host.load(boardId, signal)
      const { board: currentBoard } = state
      // Favicon loading can replace the board object without changing its data.
      // Card mutations replace the cards, so an earlier fetch cannot undo them.
      if (
        signal.aborted ||
        currentBoard?.cards !== board.cards ||
        !canRefreshBoard(state)
      )
        return
      await applyFreshBoard(boardId, currentBoard, fresh, linkedCardId)
    } catch (error) {
      // Transient failures leave the visible snapshot available for the next poll.
      if (!signal.aborted && isBoardUnavailable(error))
        await discardBoard(error)
    } finally {
      if (boardRefreshController === requestController)
        boardRefreshController = undefined
    }
  }
  const syncRefreshedBoardTab = (
    boardId: string,
    previousName: string,
    updated: TrelloBoard,
    sameFavicon: boolean,
  ): void => {
    if (!sameFavicon) {
      faviconController?.abort()
      refreshFavicon(boardId, updated, generation)
    }
    if (updated.name !== previousName) {
      if (rememberBoardNames([{ id: boardId, name: updated.name }]))
        void saveBoardPreferences()
      void syncTab(updated.name, updated.faviconUrl)
    } else if (!sameFavicon) {
      void syncFavicon(updated.faviconUrl || '')
    }
  }
  const applyFreshBoard = async (
    boardId: string,
    board: TrelloBoard,
    fresh: TrelloBoard,
    linkedCardId?: string,
  ): Promise<void> => {
    const previousById = new Map(board.cards.map((card) => [card.id, card]))
    const renewBefore = Date.now() + 60_000
    const cards = fresh.cards.map((card) => {
      const previous = previousById.get(card.id)
      const { coverImage: incomingCover, ...fields } = card
      const previousCover = previous?.coverImage
      // Keep the image source stable across board polls while its link is valid.
      const coverImage =
        previousCover &&
        incomingCover?.attachmentId === previousCover.attachmentId &&
        incomingCover.grant === previousCover.grant &&
        previousCover.expiresAt > renewBefore
          ? previousCover
          : incomingCover
      if (previous) {
        const { coverImage: _previousCover, ...previousFields } = previous
        if (
          coverImage === previousCover &&
          JSON.stringify(fields) === JSON.stringify(previousFields)
        )
          return previous
      }
      return coverImage && coverImage !== incomingCover
        ? { ...card, coverImage }
        : card
    })
    const {
      cards: _oldCards,
      faviconUrl: _oldIcon,
      lists: oldLists,
      ...oldMetadata
    } = board
    const {
      cards: _freshCards,
      faviconUrl: freshIcon,
      lists,
      ...metadata
    } = fresh
    const changed =
      cards.length !== board.cards.length ||
      cards.some((card, index) => card !== board.cards[index]) ||
      JSON.stringify(lists) !== JSON.stringify(oldLists) ||
      JSON.stringify(metadata) !== JSON.stringify(oldMetadata)
    if (!changed && !linkedCardId) return
    const sameFavicon =
      JSON.stringify(fresh.faviconBackground) ===
      JSON.stringify(board.faviconBackground)
    const faviconUrl = sameFavicon ? board.faviconUrl : freshIcon
    const updated = changed
      ? {
          ...metadata,
          cards,
          lists,
          ...(faviconUrl !== undefined && { faviconUrl }),
        }
      : board
    host.session.set(boardId, { board: updated })
    const { listActionsId } = state
    state = {
      ...state,
      board: updated,
      listActionsId:
        listActionsId && lists.find(({ id }) => id === listActionsId)?.id,
    }
    if (linkedCardId) restoreLinkedCard(updated, linkedCardId)
    syncRefreshedBoardTab(boardId, board.name, updated, sameFavicon)
    const { editingCardId } = state
    if (editingCardId) {
      const card = cards.find(({ id }) => id === editingCardId)
      if (card) {
        await sendDetail({
          card,
          descriptionChanged: card.desc !== previousById.get(card.id)?.desc,
          lists: updated.lists,
          type: 'refresh',
        })
      } else {
        closeEditor()
      }
    }
    await notify()
  }
  const scheduleBoardRefresh = (): void => {
    if (disposed) return
    boardRefreshTimer = setTimeout(() => {
      void refreshBoard().finally(scheduleBoardRefresh)
    }, boardRefreshInterval)
    boardRefreshTimer.unref?.()
  }
  const openCard = (id: string): void => {
    const { board } = state
    const card = board?.cards.find((item) => item.id === id)
    if (!card || detailFrame?.saving) return
    // Reuse an in-flight press or a result that completed during the gesture.
    const prefetch =
      cardPrefetch?.id === id &&
      (cardPrefetch.completedAt === undefined ||
        performance.now() - cardPrefetch.completedAt < 1000)
        ? cardPrefetch
        : undefined
    if (prefetch) cardPrefetch = undefined
    cancel()
    showCard(card, prefetch)
    void syncBoardHash()
  }
  const changeBoard = async (name: string | undefined): Promise<void> => {
    const showOverview = name === 'board-overview'
    if (
      !showOverview &&
      name !== 'board-change' &&
      !name?.startsWith('board-select:')
    )
      return
    cancel()
    searchGeneration++
    searchController?.abort()
    if (searchTimer) clearTimeout(searchTimer)
    const { accountConnected, boards } = state
    state = {
      ...state,
      board: undefined,
      boardId: name?.startsWith('board-select:')
        ? name.slice('board-select:'.length)
        : '',
      editingCardId: undefined,
      error: undefined,
      loading: false,
      optionsOpen: false,
      providerSelected: showOverview && Boolean(accountConnected),
      searchQuery: '',
    }
    const { boardId } = state
    await setBoardHash(host, boardId ? getBoardHash(boardId) : '')
    await restoreConnection(boardId)
    if (showOverview && !disposed && (!accountConnected || boards.length === 0))
      void checkAccount(true)
    if (boardId && !host.session.get(boardId)) void connect(undefined, true)
  }
  const openSearchCard = async (id: string): Promise<void> => {
    const { searchResults = [] } = state
    const result = searchResults.find(
      (item) => item.kind === 'card' && item.id === id,
    )
    if (!result?.boardId) return
    cancel()
    const requestGeneration = generation
    controller = new AbortController()
    state = {
      ...state,
      accountConnected: true,
      board: undefined,
      boardId: result.boardId,
      editingCardId: undefined,
      error: undefined,
      loading: true,
      searchQuery: '',
    }
    await syncFavicon('')
    await notify()
    try {
      const board = await host.load(
        result.boardId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
      )
      if (disposed || requestGeneration !== generation) return
      host.session.set(result.boardId, { board })
      state = { ...state, board, loading: false }
      await syncTab(board.name, board.faviconUrl)
      if (disposed || requestGeneration !== generation) return
      refreshFavicon(result.boardId, board, requestGeneration)
      const card = board.cards.find((item) => item.id === id)
      if (card) showCard(card)
      await syncBoardHash()
      await notify()
    } catch (error) {
      if (disposed || requestGeneration !== generation) return
      state = {
        ...state,
        error:
          error instanceof TrelloError
            ? error.details
            : {
                code: 'TRELLO_REQUEST_FAILED',
                message: 'Unable to load this board. Try again.',
              },
        loading: false,
      }
      await notify()
    }
  }
  const handleClick = async (event: Readonly<ViewEvent>): Promise<void> => {
    if (event.name === 'board-options') {
      const { optionsOpen } = state
      state = { ...state, optionsOpen: !optionsOpen }
      return
    }
    const providerAction = getProviderAction(event.name)
    if (providerAction) {
      const { error } = state
      state = {
        ...state,
        error: providerAction === 'providers' ? undefined : error,
        providerSelected: providerAction === 'trello',
      }
      if (providerAction === 'trello') void checkAccount()
      else cancel()
      return
    }
    if (event.name?.startsWith('board-card:')) {
      openCard(event.name.slice('board-card:'.length))
      return
    }
    if (event.name?.startsWith('board-search-card:')) {
      void openSearchCard(event.name.slice('board-search-card:'.length))
      return
    }
    await changeBoard(event.name)
    if (event.name === 'board-disconnect') await disconnect()
  }
  const handleSearchBlur = (): void => {
    searchGeneration++
    searchController?.abort()
    if (searchTimer) clearTimeout(searchTimer)
    state = { ...state, searchLoading: false }
    void notify()
  }
  const handleSearchEvent = async (
    event: Readonly<ViewEvent>,
  ): Promise<boolean> => {
    if (event.type === 'blur' && event.name === 'board-search') {
      handleSearchBlur()
      return true
    }
    return false
  }
  const handleNonClickEvent = (event: Readonly<ViewEvent>): boolean => {
    if (event.type === 'input' && typeof event.value === 'string') {
      handleInput(event.name, event.value)
      return true
    }
    if (event.type === 'submit' && event.name === 'board-create-card') {
      void createCard()
      return true
    }
    if (
      (event.type === 'submit' && event.name === 'board-connect') ||
      (event.type === 'click' &&
        ['board-refresh', 'board-retry'].includes(event.name || ''))
    ) {
      // View commands are serialized. Return so the loading frame and final
      // rerender are never queued behind the network request they await.
      state = { ...state, optionsOpen: false }
      void connect()
      return true
    }
    return false
  }
  const handleActionClick = (name: string | undefined): boolean => {
    if (name?.startsWith('board-add:')) {
      openNewCard(name.slice('board-add:'.length))
      return true
    }
    const actions: Readonly<Record<string, () => void | Promise<void>>> = {
      'board-authorize': authorize,
      'board-authorize-covers': authorizeCovers,
      'board-cancel-authorization': cancelAuthorization,
      'board-cancel-card': cancelCard,
      'board-check-account': checkAccount,
      'board-disconnect-account': revoke,
      'board-reconnect-card': () => authorize(true),
    }
    const action = actions[name || '']
    if (!action) return false
    state = { ...state, optionsOpen: false }
    void action()
    return true
  }
  const handleCardDetailEvent = async (
    event: Readonly<ViewEvent>,
  ): Promise<boolean> => {
    const { board, editingCardId } = state
    const { name } = event
    if (!editingCardId || !isCardDetailEvent(name)) return false
    if (name === 'board-card-cancel' && !detailSession) {
      closeEditor()
    } else if (name === 'board-card-details-retry' && detailStartupFailed) {
      const card = board?.cards.find(({ id }) => id === editingCardId)
      if (card) showCard(card)
    } else {
      await sendDetail({ event, type: 'event' })
    }
    return true
  }
  const getDetailDialog = (): Node | undefined => {
    const { editingCardId } = state
    if (!editingCardId) return undefined
    if (detailStartupFailed) return renderCardStartupError()
    return detailFrame?.dialog ?? renderCardLoading()
  }
  const instance: BoardViewInstance = {
    dispose(): void {
      disposed = true
      clearTimeout(boardRefreshTimer)
      cancel()
      searchGeneration++
      searchController?.abort()
      if (searchTimer) clearTimeout(searchTimer)
      void (async (): Promise<void> => {
        try {
          await restoreTab()
        } catch {
          // Ignore title restoration when the host is shutting down.
        }
      })()
    },
    getContext: () => ({
      ...detailFocus,
      focusNewCard,
      focusRestore,
    }),
    // View commands are serialized: return before waiting for a rerender
    // queued behind this command, including the optimistic drop frame.
    handleBoardDragEnd(): void {
      void clearDrag()
    },
    handleBoardDragOver(name: string): void {
      const { board, draggedCardId, dropTargetId, editingCardId, loading } =
        state
      const listId = name.startsWith('board-list:')
        ? name.slice('board-list:'.length)
        : ''
      if (
        loading ||
        editingCardId ||
        !draggedCardId ||
        !board?.lists.some(({ id }) => id === listId) ||
        dropTargetId === listId
      )
        return
      state = { ...state, dropTargetId: listId }
      void notify()
    },
    handleBoardDragStart(name: string): void {
      const { board, editingCardId, loading } = state
      const cardId = name.startsWith('board-card:')
        ? name.slice('board-card:'.length)
        : ''
      if (
        loading ||
        editingCardId ||
        !board?.cards.some((card) => card.id === cardId)
      )
        return
      cancelCardPrefetch()
      state = { ...state, draggedCardId: cardId, dropTargetId: undefined }
      void notify()
    },
    handleBoardDrop(name: string): void {
      void moveCard(name)
    },
    handleCardPaste(files, targetName, selectionStart, selectionEnd): void {
      if (!Array.isArray(files)) return
      const images: File[] = files.filter(
        (file): file is File =>
          file instanceof File && file.type.startsWith('image/'),
      )
      if (images.length === 0) return
      void sendDetail({
        files: images,
        selectionEnd,
        selectionStart,
        targetName,
        type: 'paste',
      })
    },
    handleCardPointerDown(
      name: string,
      button: number,
      primary: boolean,
    ): void {
      if (button === 0 && primary) prefetchCard(name)
    },
    handleDialogKeyDown(
      key: unknown,
      targetName?: unknown,
      ctrlKey?: unknown,
      isComposing?: unknown,
    ): void {
      const { editingCardId, listActionsId, optionsOpen } = state
      if (key === 'Escape' && listActionsId) {
        state = { ...state, listActionsId: undefined }
        focusRestoreName = `list-actions:${listActionsId}`
        focusRestore = !focusRestore
        return
      }
      if (key === 'Escape' && optionsOpen) {
        state = { ...state, optionsOpen: false }
        return
      }
      if (key === 'Escape' && !detailSession && editingCardId) {
        closeEditor()
        return
      }
      void sendDetail({ ctrlKey, isComposing, key, targetName, type: 'key' })
    },
    handleDialogOverlayClick(className: unknown): void {
      if (className === 'BoardDialogOverlay')
        void sendDetail({ type: 'overlay' })
    },
    async handleEvent(event: Readonly<ViewEvent>): Promise<void> {
      if (event.type === 'click') {
        const { listActionsId } = state
        if (event.name?.startsWith('list-actions:')) {
          const id = event.name.slice('list-actions:'.length)
          state = {
            ...state,
            listActionsId: listActionsId === id ? undefined : id,
            optionsOpen: false,
          }
          return
        }
        if (listActionsId) state = { ...state, listActionsId: undefined }
      }
      if (await handleCardDetailEvent(event)) return
      if (await handleSearchEvent(event)) return
      if (handleNonClickEvent(event)) return
      if (isCardTitleBlur(event)) {
        // Keep entered text when focus moves to a composer action.
        dismissCardAfterBlur()
        return
      }
      if (event.type === 'click') {
        if (handleActionClick(event.name)) return
        await handleClick(event)
      }
    },
    render: () => render(state, getDetailDialog()),
    renderFocus: (
      oldContext: Readonly<Record<string, boolean>>,
      newContext: Readonly<Record<string, boolean>>,
    ): string => {
      const { cardDraft, editingCardId } = state
      if (
        editingCardId &&
        oldContext.focusCardTitle !== newContext.focusCardTitle
      )
        return detailFrame?.editingTitle
          ? '[name="edit-card-name"]'
          : '[name="board-card-title-edit"]'
      if (
        editingCardId &&
        oldContext.focusDescription !== newContext.focusDescription
      )
        return '[name="edit-card-desc"]'
      if (oldContext.focusCardActions !== newContext.focusCardActions)
        return '[name="board-card-actions"]'
      if (editingCardId && oldContext.focusComment !== newContext.focusComment)
        return '[name="board-comment-text"]'
      if (oldContext.focusEditor !== newContext.focusEditor && editingCardId)
        return '[role="dialog"]'
      if (oldContext.focusNewCard !== newContext.focusNewCard && cardDraft)
        return '[name="board-card-title"]'
      if (oldContext.focusRestore === newContext.focusRestore) return ''
      return `[name="${focusRestoreName}"]`
    },
    renderTitle: (): string => {
      const { board } = state
      return board?.name || 'Boards'
    },
    // Deliberately omit credentials and fetched board contents from saved state.
    saveState: (): unknown => {
      const { boardId } = state
      return { boardId }
    },
  }
  const restoreInitialBoard = (): void => {
    if (!initialBoard) {
      if (urlBoardId) void connect(urlCardId, true)
      else void checkAccount(true)
      return
    }
    refreshFavicon(initialId, initialBoard, generation)
    if (!urlCardId) {
      if (!urlBoardId) void syncBoardHash()
      return
    }
    restoreLinkedCard(initialBoard, urlCardId)
  }
  restoreInitialBoard()
  scheduleBoardRefresh()
  return instance
}

export const view: View<VirtualDomViewInstance> = {
  create: createInstance,
  displayName: 'Boards',
  eventListeners: [
    {
      name: 'handleCardPointerDown',
      params: [
        'handleCardPointerDown',
        'event.currentTarget.name',
        'event.button',
        'event.isPrimary',
      ],
    },
    {
      name: 'handleBoardDragStart',
      params: ['handleBoardDragStart', 'event.currentTarget.name'],
    },
    {
      name: 'handleBoardDragOver',
      params: ['handleBoardDragOver', 'event.currentTarget.name'],
      preventDefault: true,
    },
    {
      name: 'handleBoardDrop',
      params: ['handleBoardDrop', 'event.currentTarget.name'],
      preventDefault: true,
    },
    {
      name: 'handleBoardDragEnd',
      params: ['handleBoardDragEnd'],
    },
    {
      name: 'handleDialogOverlayClick',
      params: ['handleDialogOverlayClick', 'event.target.className'],
    },
    {
      name: 'handleCardPaste',
      params: [
        'handleCardPaste',
        'event.clipboardData.files',
        'event.target.name',
        'event.target.selectionStart',
        'event.target.selectionEnd',
      ],
    },
    {
      name: 'handleDialogKeyDown',
      params: [
        'handleDialogKeyDown',
        'event.key',
        'event.target.name',
        'event.ctrlKey',
        'event.isComposing',
      ],
    },
  ],
  icon: 'project',
  id: viewId,
  kind: 'virtualDom',
  title: 'Boards',
}
