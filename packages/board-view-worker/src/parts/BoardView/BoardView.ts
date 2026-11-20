import {
  executeCommand,
  getPreference,
  setPreference,
  type View,
  type ViewContext,
  type ViewEvent,
  type VirtualDomViewInstance,
} from '@lvce-editor/api'
import type { Node } from '../VirtualDom/VirtualDom.ts'
import type { CardDetails } from './CardDetails.ts'
import {
  getBoardHash,
  getUrl,
  isBoardPath,
  parseBoardHash,
} from '../BoardUrl/BoardUrl.ts'
import { getWorkspaceTitle } from '../WorkspaceTitle/WorkspaceTitle.ts'
import { createBoardFavicon } from './BoardFavicon.ts'
import { createSession, type BoardSession } from './BoardSession.ts'
import { renderDescriptionMarkdown } from './DescriptionMarkdownWorker.ts'
import { render, type BoardState } from './Render.ts'
import {
  boardIdPattern,
  isBoardPickerAccessError,
  trelloClient,
  parseBoardId,
  TrelloError,
  type TrelloBoard,
  type TrelloCard,
  type TrelloList,
} from './Trello.ts'

export const viewId = 'chat2.views.board'
const connectionsPreference = 'chat2.connectedBoardIds'

const isCardTitleBlur = (event: Readonly<ViewEvent>): boolean =>
  event.type === 'blur' && event.name === 'board-card-title'

export interface BoardHost {
  readonly authorize: typeof trelloClient.authorize
  readonly boards: typeof trelloClient.boards
  readonly cachedBoards: typeof trelloClient.cachedBoards
  readonly createCard: typeof trelloClient.createCard
  readonly createFavicon: typeof createBoardFavicon
  readonly execute: typeof executeCommand
  readonly load: typeof trelloClient.load
  readonly loadCard: typeof trelloClient.loadCard
  readonly loadCovers: typeof trelloClient.loadCovers
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
  readonly completedAt: number | undefined
  readonly consume: LoadPrefetchedCard
  readonly controller: AbortController
  readonly id: string
}

interface BoardViewInstance extends VirtualDomViewInstance, BoardDragHandlers {
  readonly handleCardPointerDown: (
    name: string,
    button: number,
    primary: boolean,
  ) => void
  readonly handleDialogKeyDown: (key: unknown) => void
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
  authorize: trelloClient.authorize,
  boards: trelloClient.boards,
  cachedBoards: trelloClient.cachedBoards,
  createCard: trelloClient.createCard,
  createFavicon: createBoardFavicon,
  execute: executeCommand,
  load: trelloClient.load,
  loadCard: trelloClient.loadCard,
  loadCovers: trelloClient.loadCovers,
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
}

const getHrefFromHost = async (host: BoardHost): Promise<string> => {
  try {
    const href = await host.execute('Layout.getHref')
    return typeof href === 'string' ? href : ''
  } catch {
    return ''
  }
}

const setBoardHash = async (
  host: BoardHost,
  hash: string,
  isCurrent?: () => boolean,
): Promise<void> => {
  try {
    const href = await getHrefFromHost(host)
    const url = getUrl(href)
    if (!url || !isBoardPath(url.pathname) || isCurrent?.() === false) return
    await host.execute('Layout.setHash', hash)
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

export const createInstance = async (
  context?: ViewContext,
  host: BoardHost = defaultHost,
): Promise<BoardViewInstance> => {
  let connectedIds: readonly string[] = []
  try {
    const saved: unknown = await host.read(connectionsPreference)
    if (Array.isArray(saved))
      connectedIds = saved.filter(
        (id): id is string => typeof id === 'string' && boardIdPattern.test(id),
      )
  } catch {
    // The connection form remains usable when settings cannot be read.
  }
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
    error: undefined,
    loading: false,
    providerSelected: false,
  }
  let generation = 0
  let controller: AbortController | undefined
  let detailsController: AbortController | undefined
  let faviconController: AbortController | undefined
  let searchController: AbortController | undefined
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchGeneration = 0
  let descriptionGeneration = 0
  let pendingDescriptionKey: string | undefined
  let moveController: AbortController | undefined
  let cardPrefetch: CardPrefetch | undefined
  let disposed = false
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
  let focusEditor = false
  let focusNewCard = false
  let focusRestore = false
  let focusCardId = ''
  const notify = async (): Promise<void> => {
    if (!disposed) await context?.requestRerender()
  }
  const prepareDescription = async (
    text: string,
    signal: Readonly<AbortSignal>,
  ): Promise<
    Pick<
      BoardState,
      'descriptionError' | 'renderedDescription' | 'renderedDescriptionText'
    >
  > => {
    if (!text) return {}
    try {
      const markdown = await host.renderDescriptionMarkdown(text)
      signal.throwIfAborted()
      return {
        renderedDescription: await host.loadDescriptionImages(markdown, signal),
        renderedDescriptionText: text,
      }
    } catch {
      return { descriptionError: 'Unable to render the description preview.' }
    }
  }
  const renderDescription = async (text: string): Promise<void> => {
    const {
      editDescription,
      editingCard,
      renderedDescription,
      renderedDescriptionText,
    } = state
    if (!text || !editingCard || editDescription || disposed) return
    if (renderedDescriptionText === text && renderedDescription) return
    const key = `${editingCard.id}\0${text}`
    if (pendingDescriptionKey === key) return
    const requestGeneration = ++descriptionGeneration
    const cardId = editingCard.id
    pendingDescriptionKey = key
    state = {
      ...state,
      descriptionError: undefined,
      descriptionRendering: true,
      renderedDescription: undefined,
      renderedDescriptionText: undefined,
    }
    await notify()
    const preview = await prepareDescription(
      text,
      detailsController?.signal ?? new AbortController().signal,
    )
    const {
      editDesc: currentEditDesc,
      editDescription: isEditingDescription,
      editingCard: currentEditingCard,
    } = state
    if (requestGeneration !== descriptionGeneration) return
    pendingDescriptionKey = undefined
    if (
      disposed ||
      currentEditingCard?.id !== cardId ||
      currentEditDesc !== text ||
      isEditingDescription
    )
      return
    state = { ...state, ...preview, descriptionRendering: false }
    await notify()
  }
  const clearDrag = async (): Promise<void> => {
    const { draggedCardId, dropTargetId } = state
    if (!draggedCardId && !dropTargetId) return
    state = { ...state, draggedCardId: undefined, dropTargetId: undefined }
    await notify()
  }
  const cancelCardPrefetch = (): void => {
    cardPrefetch?.controller.abort()
    cardPrefetch = undefined
  }
  const cancel = (preserveDraft = false): void => {
    const { cardDraft, detailsLoading } = state
    generation++
    cancelCardPrefetch()
    controller?.abort()
    detailsController?.abort()
    faviconController?.abort()
    moveController?.abort()
    state = {
      ...state,
      authorizationUrl: undefined,
      authorizing: false,
      cardDraft: preserveDraft && !cardDraft?.saving ? cardDraft : undefined,
      discoveringBoards: false,
      ...(detailsLoading && {
        detailsLoading: false,
        editingCard: undefined,
      }),
      loading: false,
      savingCard: false,
    }
  }
  const syncBoardHash = (): Promise<void> => {
    const { boardId, editingCard } = state
    const cardId = editingCard?.id
    return setBoardHash(host, getBoardHash(boardId, cardId), () => {
      const { boardId: currentBoardId, editingCard: currentCard } = state
      return (
        !disposed && currentBoardId === boardId && currentCard?.id === cardId
      )
    })
  }
  const closeEditor = (): void => {
    const { editingCard } = state
    if (editingCard) {
      focusCardId = editingCard.id
      focusRestore = !focusRestore
    }
    state = { ...state, editError: undefined, editingCard: undefined }
    if (editingCard) void syncBoardHash()
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
  const connect = async (cardId?: string): Promise<void> => {
    const { board } = state
    cancel(Boolean(board))
    const requestGeneration = generation
    controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(45_000),
    ])
    state = { ...state, error: undefined, loading: true }
    try {
      const { boardId, connectedIds } = state
      const board = await host.load(boardId, signal)
      if (disposed || requestGeneration !== generation) return
      const id = parseBoardId(boardId)
      const card = board.cards.find((item) => item.id === cardId)
      await setBoardHash(
        host,
        getBoardHash(id, card?.id),
        () => !disposed && requestGeneration === generation,
      )
      if (disposed || requestGeneration !== generation) return
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
      if (card) showCard(card)
      await notify()
      void host
        .loadCovers(id, signal)
        .then(async (covers) => {
          if (
            disposed ||
            requestGeneration !== generation ||
            covers.length === 0
          )
            return
          const current = host.session.get(id)?.board
          if (!current) return
          const coverById = new Map(
            covers.map(({ coverDataUrl, id: cardId }) => [
              cardId,
              coverDataUrl,
            ]),
          )
          const enrichedBoard = {
            ...current,
            cards: current.cards.map((card) => {
              const coverDataUrl = coverById.get(card.id)
              return coverDataUrl ? { ...card, coverDataUrl } : card
            }),
          }
          host.session.set(id, { board: enrichedBoard })
          state = { ...state, board: enrichedBoard }
          await notify()
        })
        .catch(() => {
          // Covers are optional; the core board is already available.
        })
      await syncTab(board.name, board.faviconUrl)
      refreshFavicon(id, board, requestGeneration)
      try {
        await host.write(connectionsPreference, ids)
      } catch {
        if (disposed || requestGeneration !== generation) return
        state = {
          ...state,
          error: {
            code: 'BOARD_SETTINGS_FAILED',
            message:
              'The board is connected, but its ID could not be saved. Reconnect it next time.',
          },
        }
      }
    } catch (error) {
      if (disposed || requestGeneration !== generation) return
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
        ...(error instanceof TrelloError &&
          error.details.code === 'TRELLO_CONNECTION_REQUIRED' && {
            accountConnected: false,
            board: undefined,
            providerSelected: true,
          }),
      }
    }
    const { board: activeBoard } = state
    if (!activeBoard) await syncFavicon('')
    await notify()
  }
  const saveCard = async (): Promise<void> => {
    const { detailsError, detailsLoading } = state
    if (detailsLoading || detailsError) return
    const {
      board,
      boardId,
      editDesc = '',
      editingCard,
      editName = '',
      savingCard,
    } = state
    if (!board || !editingCard || savingCard || !editName.trim()) return
    cancel()
    const requestGeneration = generation
    controller = new AbortController()
    state = { ...state, editError: undefined, savingCard: true }
    await notify()
    try {
      const updatedCard = await host.updateCard(
        editingCard.id,
        editName,
        editDesc,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      )
      if (disposed || requestGeneration !== generation) return
      const updatedBoard = {
        ...board,
        cards: board.cards.map((card) =>
          card.id === updatedCard.id ? updatedCard : card,
        ),
      }
      host.session.set(boardId, { board: updatedBoard })
      state = {
        ...state,
        board: updatedBoard,
        editError: undefined,
        savingCard: false,
      }
      closeEditor()
    } catch (error) {
      if (disposed || requestGeneration !== generation) return
      state = {
        ...state,
        editError:
          error instanceof TrelloError
            ? error.details.message
            : 'Unable to save this card. Check your connection and try again.',
        savingCard: false,
      }
    }
    await notify()
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
    moveController = requestController
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
    if (moveController === requestController) moveController = undefined
    await notify()
  }
  const disconnect = async (): Promise<void> => {
    cancel()
    const { boardId, connectedIds } = state
    await setBoardHash(host, '')
    await syncTab('Boards')
    host.session.remove(boardId)
    const ids = connectedIds.filter((id) => id !== boardId)
    state = {
      ...state,
      board: undefined,
      boardId: '',
      connectedIds: ids,
      error: undefined,
      loading: false,
      providerSelected: false,
      searchQuery: '',
    }
    try {
      await host.write(connectionsPreference, ids)
    } catch {
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
      const { connected } = await host.status(signal)
      signal.throwIfAborted()
      if (connected) return
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
      const url = await host.authorize(signal)
      if (disposed || generation !== requestGeneration) return
      state = { ...state, authorizationUrl: url }
      await notify()
      await waitForAuthorization(signal)
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
    const { authorizing, board, boardId, cardDraft, editingCard, loading } =
      state
    if (
      !board ||
      editingCard ||
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
    const { authorizing, board, cardDraft, editingCard, loading } = state
    if (
      !editingCard &&
      !loading &&
      !authorizing &&
      !cardDraft?.saving &&
      board?.lists.some((list) => list.id === listId)
    ) {
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
      case 'edit-card-desc':
        descriptionGeneration++
        pendingDescriptionKey = undefined
        state = { ...state, editDesc: value, editError: undefined }
        break
      case 'edit-card-name':
        state = { ...state, editError: undefined, editName: value }
        break
    }
  }
  const prefetchCard = (name: string): void => {
    const { board, editingCard, loading } = state
    if (disposed || editingCard || loading || !name.startsWith('board-card:'))
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
      get completedAt(): number | undefined {
        return completedAt
      },
      consume(show): Promise<CardDetails | undefined> {
        showCached = show
        if (cached) show(cached)
        return result
      },
      controller: requestController,
      id,
    }
  }
  const showDetails = (
    details: CardDetails,
    loading: boolean,
    preview?: Awaited<ReturnType<typeof prepareDescription>>,
  ): void => {
    const { details: previousDetails, editDesc } = state
    const firstDetails = !previousDetails
    const descriptionChanged = firstDetails || editDesc !== details.desc
    if (descriptionChanged) {
      descriptionGeneration++
      pendingDescriptionKey = undefined
    }
    state = {
      ...state,
      details,
      detailsLoading: loading,
      editDesc: details.desc,
      ...(descriptionChanged && {
        descriptionError: undefined,
        descriptionRendering: false,
        renderedDescription: undefined,
        renderedDescriptionText: undefined,
        ...preview,
      }),
    }
    if (firstDetails) focusEditor = !focusEditor
    if (descriptionChanged && !preview && details.desc) {
      void renderDescription(details.desc)
    } else {
      void notify()
    }
  }
  const loadCardDetails = async (
    loadPrefetched?: LoadPrefetchedCard,
  ): Promise<void> => {
    const { detailsLoading, editingCard, savingCard } = state
    if (!editingCard || savingCard || detailsLoading) return
    // A retry can keep rendering the cached description while it refreshes.
    if (!detailsController || detailsController.signal.aborted) {
      detailsController = new AbortController()
    }
    const { signal } = detailsController
    const isCurrent = (): boolean => !disposed && !signal.aborted
    state = { ...state, detailsError: undefined, detailsLoading: true }
    const showCached = (details: CardDetails): void => {
      const { details: previousDetails } = state
      if (isCurrent() && !previousDetails) showDetails(details, true)
    }
    try {
      const details = await (loadPrefetched
        ? loadPrefetched(showCached)
        : host.loadCard(editingCard.id, signal, showCached))
      if (!isCurrent()) return
      if (!details) throw new Error('Card details request failed')
      // Keep the existing staged opening on a cold load.
      const { details: previousDetails } = state
      const preview = previousDetails
        ? undefined
        : await prepareDescription(details.desc, signal)
      if (isCurrent()) showDetails(details, false, preview)
    } catch {
      if (!isCurrent()) return
      const { details } = state
      if (!details) focusEditor = !focusEditor
      state = {
        ...state,
        detailsError: details
          ? 'Unable to refresh card details. Try again.'
          : 'Unable to load card details. Try again.',
        detailsLoading: false,
      }
      await notify()
    }
  }
  const showCard = (
    card: TrelloCard,
    loadPrefetched?: LoadPrefetchedCard,
  ): void => {
    state = {
      ...state,
      descriptionError: undefined,
      descriptionRendering: false,
      details: undefined,
      detailsError: undefined,
      editDesc: card.desc || '',
      editDescription: false,
      editError: undefined,
      editingCard: card,
      editName: card.name,
      renderedDescription: undefined,
      renderedDescriptionText: undefined,
      savingCard: false,
    }
    void loadCardDetails(loadPrefetched)
  }
  const openCard = (id: string): void => {
    const { board, savingCard } = state
    const card = board?.cards.find((item) => item.id === id)
    if (!card || savingCard) return
    // Reuse an in-flight press or a result that completed during the gesture.
    const prefetch =
      cardPrefetch?.id === id &&
      (cardPrefetch.completedAt === undefined ||
        performance.now() - cardPrefetch.completedAt < 1000)
        ? cardPrefetch
        : undefined
    if (prefetch) cardPrefetch = undefined
    cancel()
    detailsController = prefetch?.controller
    showCard(card, prefetch?.consume)
    void syncBoardHash()
  }
  const changeBoard = async (name: string | undefined): Promise<void> => {
    if (name !== 'board-change' && !name?.startsWith('board-select:')) return
    cancel()
    searchGeneration++
    searchController?.abort()
    if (searchTimer) clearTimeout(searchTimer)
    state = {
      ...state,
      board: undefined,
      boardId: name.startsWith('board-select:')
        ? name.slice('board-select:'.length)
        : '',
      editError: undefined,
      editingCard: undefined,
      error: undefined,
      loading: false,
      optionsOpen: false,
      providerSelected: false,
      savingCard: false,
      searchQuery: '',
    }
    const { boardId } = state
    await setBoardHash(host, boardId ? getBoardHash(boardId) : '')
    await restoreConnection(boardId)
    if (boardId && !host.session.get(boardId)) void connect()
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
      editingCard: undefined,
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
  const handleDescriptionClick = (name: string | undefined): boolean => {
    if (name === 'board-description-edit') {
      const { editDesc, editDescription } = state
      state = { ...state, editDescription: !editDescription }
      if (editDescription) void renderDescription(editDesc || '')
      else {
        descriptionGeneration++
        pendingDescriptionKey = undefined
      }
      return true
    }
    if (name === 'board-description-retry') {
      const { editDesc } = state
      void renderDescription(editDesc || '')
      return true
    }
    return false
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
    if (event.name === 'board-card-details-retry') {
      void loadCardDetails()
      return
    }
    if (handleDescriptionClick(event.name)) return
    if (event.name === 'board-card-cancel') {
      const { savingCard } = state
      if (savingCard) return
      closeEditor()
      cancel()
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
    if (event.type === 'submit' && event.name === 'board-card-edit') {
      void saveCard()
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
  const instance: BoardViewInstance = {
    dispose(): void {
      disposed = true
      descriptionGeneration++
      pendingDescriptionKey = undefined
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
    getContext: () => ({ focusEditor, focusNewCard, focusRestore }),
    // View commands are serialized: return before waiting for a rerender
    // queued behind this command, including the optimistic drop frame.
    handleBoardDragEnd(): void {
      void clearDrag()
    },
    handleBoardDragOver(name: string): void {
      const { board, draggedCardId, dropTargetId, editingCard, loading } = state
      const listId = name.startsWith('board-list:')
        ? name.slice('board-list:'.length)
        : ''
      if (
        loading ||
        editingCard ||
        !draggedCardId ||
        !board?.lists.some(({ id }) => id === listId) ||
        dropTargetId === listId
      )
        return
      state = { ...state, dropTargetId: listId }
      void notify()
    },
    handleBoardDragStart(name: string): void {
      const { board, editingCard, loading } = state
      const cardId = name.startsWith('board-card:')
        ? name.slice('board-card:'.length)
        : ''
      if (
        loading ||
        editingCard ||
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
    handleCardPointerDown(
      name: string,
      button: number,
      primary: boolean,
    ): void {
      if (button === 0 && primary) prefetchCard(name)
    },
    handleDialogKeyDown(key: unknown): void {
      const { editingCard, optionsOpen, savingCard } = state
      if (key === 'Escape' && optionsOpen) {
        state = { ...state, optionsOpen: false }
        return
      }
      if (key !== 'Escape' || !editingCard || savingCard) return
      closeEditor()
      cancel()
    },
    handleDialogOverlayClick(className: unknown): void {
      const { savingCard } = state
      if (className !== 'BoardDialogOverlay' || savingCard) return
      closeEditor()
      cancel()
    },
    async handleEvent(event: Readonly<ViewEvent>): Promise<void> {
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
    render: () => render(state),
    renderFocus: (
      oldContext: Readonly<Record<string, boolean>>,
      newContext: Readonly<Record<string, boolean>>,
    ): string => {
      const { cardDraft, editingCard } = state
      if (oldContext.focusEditor !== newContext.focusEditor && editingCard)
        return '[role="dialog"]'
      if (oldContext.focusNewCard !== newContext.focusNewCard && cardDraft)
        return '[name="board-card-title"]'
      return oldContext.focusRestore === newContext.focusRestore || !focusCardId
        ? ''
        : `[name="board-card:${focusCardId}"]`
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
      if (urlBoardId) void connect(urlCardId)
      else void checkAccount(true)
      return
    }
    refreshFavicon(initialId, initialBoard, generation)
    if (!urlCardId) return
    const card = initialBoard.cards.find((item) => item.id === urlCardId)
    if (card) showCard(card)
    else void syncBoardHash()
  }
  restoreInitialBoard()
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
      name: 'handleDialogKeyDown',
      params: ['handleDialogKeyDown', 'event.key'],
    },
  ],
  icon: 'project',
  id: viewId,
  kind: 'virtualDom',
  title: 'Boards',
}
