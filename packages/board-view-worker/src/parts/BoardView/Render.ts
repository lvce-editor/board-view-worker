/* eslint-disable unicorn/max-nested-calls */

import {
  mergeClassNames,
  VirtualDomElements,
} from '@lvce-editor/virtual-dom-worker'
import type {
  BoardError,
  TrelloBoard,
  TrelloBoardSummary,
  TrelloCard,
  TrelloSearchResult,
} from './Trello.ts'
import * as Dom from '../VirtualDom/VirtualDom.ts'

const primaryButtonClass = mergeClassNames('BoardButton', 'BoardPrimaryButton')
const cardTitleInputClass = mergeClassNames('BoardInput', 'BoardCardTitleInput')
const cancelCardClass = mergeClassNames('BoardButton', 'BoardCancelCard')
const cardButtonClass = mergeClassNames('BoardCard', 'BoardCardButton')
const searchInputClass = mergeClassNames('BoardInput', 'BoardSearchInput')

interface CardDraft {
  readonly error?: BoardError | undefined
  readonly listId: string
  readonly saving: boolean
  readonly title: string
}

export interface BoardState {
  readonly accountConnected?: boolean
  readonly authorizationUrl?: string | undefined
  readonly authorizing?: boolean
  readonly authorizingCovers?: boolean
  readonly board: TrelloBoard | undefined
  readonly boardId: string
  readonly boards: readonly TrelloBoardSummary[]
  readonly cardDraft?: CardDraft | undefined
  readonly connectedIds: readonly string[]
  readonly connectedNames: Readonly<Record<string, string>>
  readonly discoveringBoards?: boolean
  readonly draggedCardId?: string | undefined
  readonly dropTargetId?: string | undefined
  readonly editingCardId?: string | undefined
  readonly error: BoardError | undefined
  readonly listActionsId?: string | undefined
  readonly loading: boolean
  readonly optionsOpen?: boolean
  readonly providerSelected: boolean
  readonly searchError?: BoardError | undefined
  readonly searchLoading?: boolean
  readonly searchQuery?: string
  readonly searchResults?: readonly TrelloSearchResult[]
}

const authorizationActions = (
  state: Readonly<BoardState>,
  action: string,
  label: string,
): readonly Dom.Node[] => {
  const { authorizationUrl, authorizing, loading } = state
  const buttonLabel = authorizing ? 'Preparing connection…' : label
  const buttonClass =
    action === 'board-authorize' ? primaryButtonClass : 'BoardButton'
  return [
    authorizationUrl
      ? Dom.link(authorizationUrl, 'Continue to Trello', primaryButtonClass)
      : Dom.button(action, buttonLabel, buttonClass, {
          disabled: loading || Boolean(authorizing),
        }),
    ...(authorizing
      ? [
          Dom.button(
            'board-cancel-authorization',
            'Stop waiting',
            'BoardButton',
          ),
        ]
      : []),
  ]
}

const renderComposer = (
  state: BoardState,
  listId: string,
  listName: string,
): Dom.Node => {
  const { authorizing, cardDraft: draft, loading } = state
  const busy = loading || Boolean(authorizing)
  if (draft?.listId !== listId)
    return Dom.button(
      `board-add:${listId}`,
      'Add a card',
      'BoardButton BoardAddCard',
      {
        ariaLabel: `Add a card to ${listName}`,
        disabled: Boolean(draft?.saving) || busy,
      },
    )
  return Dom.form('board-create-card', 'BoardCardComposer', [
    Dom.node(VirtualDomElements.Input, {
      ariaLabel: 'Card title',
      autoComplete: 'off',
      className: cardTitleInputClass,
      disabled: draft.saving || busy,
      inputType: 'text',
      name: 'board-card-title',
      onBlur: 'handleBlur',
      onInput: 'handleInput',
      placeholder: 'Enter a card title',
      spellcheck: false,
      value: draft.title,
    }),
    ...(draft.error
      ? [
          Dom.node(
            VirtualDomElements.Div,
            { className: 'BoardCardError', role: 'alert' },
            [Dom.textNode(draft.error.message)],
          ),
        ]
      : []),
    ...(draft.error?.code === 'TRELLO_WRITE_DENIED'
      ? [
          Dom.div(
            'BoardCardActions',
            authorizationActions(
              state,
              'board-reconnect-card',
              'Reconnect Trello',
            ),
          ),
        ]
      : []),
    Dom.div('BoardCardActions', [
      Dom.node(
        VirtualDomElements.Button,
        {
          buttonType: 'submit',
          className: primaryButtonClass,
          disabled:
            draft.saving ||
            busy ||
            !draft.title.trim() ||
            draft.title.trim().length > 16_384,
        },
        [Dom.textNode(draft.saving ? 'Adding…' : 'Add card')],
      ),
      Dom.button('board-cancel-card', 'Cancel', cancelCardClass, {
        disabled: draft.saving || busy,
      }),
    ]),
  ])
}

const renderBoardTile = (
  board: TrelloBoardSummary,
  loading: boolean,
  ariaLabel = `Open ${board.name}`,
): Dom.Node =>
  Dom.node(
    VirtualDomElements.Button,
    {
      ariaLabel,
      buttonType: 'button',
      className: 'BoardTile',
      disabled: loading,
      name: `board-select:${board.id}`,
      onClick: 'handleClick',
    },
    [
      Dom.node(
        VirtualDomElements.Span,
        {
          className: 'BoardTileBackground',
          style: [
            board.backgroundColor &&
              `background-color:${board.backgroundColor}`,
            board.backgroundGradient &&
              `background-image:${board.backgroundGradient}`,
            board.backgroundColor &&
              !board.backgroundGradient &&
              'background-image:none',
          ]
            .filter(Boolean)
            .join(';'),
        },
        board.backgroundImage
          ? [
              Dom.node(VirtualDomElements.Img, {
                alt: '',
                className: 'BoardTileImage',
                src: board.backgroundImage,
              }),
            ]
          : [],
      ),
      Dom.node(VirtualDomElements.Span, { className: 'BoardTileName' }, [
        Dom.textNode(board.name),
      ]),
    ],
  )

const renderBoardTiles = (state: BoardState): Dom.Node => {
  const { boards, loading, searchQuery = '' } = state
  const query = searchQuery.trim().toLocaleLowerCase()
  const matchingBoards = query
    ? boards.filter((board) => board.name.toLocaleLowerCase().includes(query))
    : boards
  return Dom.div(
    'BoardTileGrid',
    matchingBoards.map((board) => renderBoardTile(board, loading)),
  )
}

const renderBoardSearch = (state: BoardState): Dom.Node => {
  const {
    boards,
    searchError,
    searchLoading,
    searchQuery = '',
    searchResults = [],
  } = state
  const query = searchQuery.trim().toLocaleLowerCase()
  const matchingBoards = boards.some((board) =>
    board.name.toLocaleLowerCase().includes(query),
  )
  const showEmpty = searchResults.length === 0 && !searchLoading && !searchError
  const emptyContent = matchingBoards
    ? [renderBoardTiles(state)]
    : [Dom.div('BoardSearchEmpty', [Dom.textNode('No boards or cards found')])]
  const renderSearchResult = (result: TrelloSearchResult): Dom.Node => {
    const isBoard = result.kind === 'board'
    const boardName =
      result.boardName ||
      boards.find((board) => board.id === result.boardId)?.name
    const context = [boardName, result.listName].filter(Boolean).join(' · ')
    return Dom.node(
      VirtualDomElements.Button,
      {
        buttonType: 'button',
        className: 'BoardSearchResult',
        name: isBoard
          ? `board-select:${result.id}`
          : `board-search-card:${result.id}`,
        onClick: 'handleClick',
      },
      [
        Dom.node(VirtualDomElements.Span, {
          ariaHidden: true,
          className: mergeClassNames(
            'BoardSearchResultIcon',
            isBoard ? 'BoardSearchBoardIcon' : 'BoardSearchCardIcon',
          ),
        }),
        Dom.node(
          VirtualDomElements.Span,
          { className: 'BoardSearchResultText' },
          [
            Dom.node(
              VirtualDomElements.Span,
              { className: 'BoardSearchResultTitle' },
              [Dom.textNode(result.name)],
            ),
            ...(context
              ? [
                  Dom.node(
                    VirtualDomElements.Span,
                    { className: 'BoardSearchResultContext' },
                    [Dom.textNode(context)],
                  ),
                ]
              : []),
          ],
        ),
      ],
    )
  }
  const renderSearchGroup = (
    label: string,
    results: readonly TrelloSearchResult[],
  ): readonly Dom.Node[] =>
    results.length > 0
      ? [
          Dom.node(
            VirtualDomElements.Div,
            { ariaLabel: label, className: 'BoardSearchGroup', role: 'group' },
            [
              Dom.node(
                VirtualDomElements.Div,
                { ariaHidden: true, className: 'BoardSearchGroupLabel' },
                [Dom.textNode(label)],
              ),
              ...results.map(renderSearchResult),
            ],
          ),
        ]
      : []
  return Dom.div('BoardSearch', [
    Dom.node(VirtualDomElements.Input, {
      ariaLabel: 'Search boards',
      autoComplete: 'off',
      className: searchInputClass,
      inputType: 'search',
      name: 'board-search',
      onBlur: 'handleBlur',
      onInput: 'handleInput',
      placeholder: 'Search boards and cards',
      spellcheck: false,
      value: searchQuery,
    }),
    ...(query
      ? [
          Dom.div('BoardSearchResults', [
            ...(searchLoading
              ? [
                  Dom.div('BoardSearchStatus', [
                    Dom.textNode('Searching Trello…'),
                  ]),
                ]
              : []),
            ...(searchError
              ? [
                  Dom.div('BoardSearchError', [
                    Dom.textNode(searchError.message),
                  ]),
                ]
              : []),
            ...renderSearchGroup(
              'Boards',
              searchResults.filter((result) => result.kind === 'board'),
            ),
            ...renderSearchGroup(
              'Cards',
              searchResults.filter((result) => result.kind === 'card'),
            ),
            ...(showEmpty ? emptyContent : []),
          ]),
        ]
      : []),
  ])
}

const connectionHelp = (state: BoardState): string => {
  const { boards, error } = state
  if (boards.length === 0 && !error)
    return 'No open boards found. Create a board in Trello, then refresh this list.'
  return 'Trello is connected. Choose a board to open it.'
}

const renderConnection = (state: BoardState): readonly Dom.Node[] => {
  const { accountConnected, authorizing, loading, searchQuery } = state
  return accountConnected
    ? [
        Dom.div('BoardCredentialsHelp', [Dom.textNode(connectionHelp(state))]),
        renderBoardSearch(state),
        ...(searchQuery ? [] : [renderBoardTiles(state)]),
        Dom.button('board-check-account', 'Refresh boards', 'BoardButton', {
          disabled: loading,
        }),
        Dom.button(
          'board-disconnect-account',
          'Disconnect Trello',
          'BoardButton',
          { disabled: loading },
        ),
      ]
    : [
        Dom.div('BoardCredentialsHelp', [
          Dom.textNode(
            authorizing
              ? 'Allow access in Trello. This view will update when you finish.'
              : 'Sign in to LVCE, then authorize Trello to read your boards and add cards.',
          ),
        ]),
        Dom.div(
          'BoardAuthorizationActions',
          authorizationActions(state, 'board-authorize', 'Authorize Trello'),
        ),
      ]
}
const renderSetup = (state: BoardState): Dom.Node => {
  const {
    boards,
    connectedIds,
    connectedNames,
    loading,
    providerSelected,
    searchQuery,
  } = state
  const showProviderGrid = !providerSelected
  const rememberedIds = connectedIds.filter((id) =>
    boards.every((board) => board.id !== id && board.fullId !== id),
  )
  return Dom.div('BoardSetup', [
    Dom.heading(2, 'BoardSetupTitle', 'Connect a board'),
    ...(showProviderGrid
      ? [
          Dom.div('BoardProviderGrid', [
            Dom.button(
              'board-provider:trello',
              'Connect Trello',
              'BoardProviderCard',
              { ariaLabel: 'Connect Trello' },
            ),
          ]),
        ]
      : [
          Dom.div('BoardProviderSetup', [
            Dom.button('board-providers', 'All providers', 'BoardBackButton'),
            Dom.heading(3, 'BoardProviderTitle', 'Connect a Trello board'),
          ]),
          Dom.div('BoardIntro', [
            Dom.textNode(
              'Bring your lists and cards into the editor. Add, edit, and move cards here to update them in Trello.',
            ),
          ]),
          ...renderConnection(state),
          ...(rememberedIds.length > 0 && !searchQuery
            ? [
                Dom.div('BoardRemembered', [
                  Dom.heading(3, 'BoardRememberedTitle', 'Remembered boards'),
                  ...rememberedIds.map((id) => {
                    const name = connectedNames[id] ?? id
                    return renderBoardTile(
                      { id, name },
                      loading,
                      `Open remembered board ${name}`,
                    )
                  }),
                ]),
              ]
            : []),
        ]),
  ])
}

const renderBadges = (card: Readonly<TrelloCard>): readonly Dom.Node[] => {
  const badges: Dom.Node[] = []
  for (const [count, label, icon] of [
    [card.commentCount, 'comment', 'Comment'],
    [card.attachmentCount, 'attachment', 'Attachment'],
  ] as const) {
    if (!count) continue
    const description = `${count} ${label}${count === 1 ? '' : 's'}`
    badges.push(
      Dom.node(
        VirtualDomElements.Span,
        {
          ariaLabel: description,
          className: 'BoardCardBadge',
          role: 'img',
          title: description,
        },
        [
          Dom.node(VirtualDomElements.Span, {
            ariaHidden: true,
            className: mergeClassNames(
              'BoardCardBadgeIcon',
              `BoardCardBadge${icon}Icon`,
            ),
          }),
          Dom.textNode(String(count)),
        ],
      ),
    )
  }
  return badges.length > 0 ? [Dom.div('BoardCardBadges', badges)] : []
}

const renderError = (state: Readonly<BoardState>): Dom.Node | undefined => {
  const { authorizationUrl, board, error, loading } = state
  if (!error) return undefined
  return Dom.node(
    VirtualDomElements.Div,
    { className: 'BoardError', role: 'alert' },
    [
      Dom.heading(2, 'BoardErrorTitle', error.code),
      Dom.textNode(error.message),
      ...(error.code === 'TRELLO_REAUTHORIZE_REQUIRED'
        ? [
            Dom.button('board-reconnect', 'Reconnect Trello', 'BoardButton'),
            ...(authorizationUrl
              ? [
                  Dom.link(
                    authorizationUrl,
                    'Continue to Trello',
                    primaryButtonClass,
                  ),
                ]
              : []),
          ]
        : []),
      Dom.button(
        board ? 'board-retry' : 'board-check-account',
        'Try again',
        'BoardButton',
        { disabled: loading },
      ),
    ],
  )
}

const renderListActions = (
  state: Readonly<BoardState>,
  listId: string,
  listName: string,
): Dom.Node => {
  const { authorizing, cardDraft, listActionsId, loading } = state
  const expanded = listActionsId === listId
  const disabled = loading || Boolean(authorizing || cardDraft?.saving)
  const label = `List actions for ${listName}`
  return Dom.div(
    'BoardListActions',
    [
      Dom.button(
        `list-actions:${listId}`,
        '…',
        'BoardButton BoardListActionsButton',
        {
          ariaExpanded: expanded,
          ariaLabel: label,
          disabled,
          title: 'List actions',
        },
      ),
      ...(expanded
        ? [
            Dom.node(
              VirtualDomElements.Div,
              {
                ariaLabel: label,
                className: 'BoardOverflowMenu',
                role: 'group',
              },
              [
                Dom.button(`board-add:${listId}`, 'Add card', 'BoardButton', {
                  disabled,
                }),
              ],
            ),
          ]
        : []),
    ],
    { onKeyDown: 'handleDialogKeyDown' },
  )
}

const renderColumns = (
  state: BoardState,
  board: TrelloBoard,
  cardsByList: Readonly<ReadonlyMap<string, readonly Readonly<Dom.Node>[]>>,
  dropTargetId?: string,
): Dom.Node => {
  const { cardDraft } = state
  return Dom.node(
    VirtualDomElements.Div,
    { ariaLabel: board.name, className: 'BoardColumns', tabIndex: 0 },
    board.lists.map((list) =>
      Dom.node(
        VirtualDomElements.Section,
        {
          ariaLabel: list.name,
          className: `BoardColumn${dropTargetId === list.id ? ' BoardCardsDropTarget' : ''}`,
          name: `board-list:${list.id}`,
          onDragOver: 'handleBoardDragOver',
          onDrop: 'handleBoardDrop',
        },
        [
          Dom.div('BoardColumnHeader', [
            Dom.heading(2, 'BoardColumnTitle', list.name),
            Dom.node(
              VirtualDomElements.Span,
              { className: 'BoardColumnCount' },
              [Dom.textNode(String(cardsByList.get(list.id)?.length ?? 0))],
            ),
            renderListActions(state, list.id, list.name),
          ]),
          Dom.div(
            'BoardCards',
            cardsByList.get(list.id) ||
              (cardDraft?.listId === list.id
                ? []
                : [Dom.div('BoardEmptyList', [Dom.textNode('No cards')])]),
          ),
          renderComposer(state, list.id, list.name),
        ],
      ),
    ),
  )
}

const renderToolbar = (state: BoardState): Dom.Node => {
  const { board, cardDraft, loading, optionsOpen } = state
  return Dom.node(
    VirtualDomElements.Div,
    {
      className: board
        ? 'BoardToolbar'
        : 'BoardToolbar BoardToolbarWithoutBoard',
    },
    [
      board
        ? Dom.node(
            VirtualDomElements.Nav,
            { ariaLabel: 'Breadcrumb', className: 'BoardBreadcrumb' },
            [
              Dom.button('board-overview', 'Boards', 'BoardBreadcrumbButton', {
                disabled: loading || Boolean(cardDraft?.saving),
              }),
              Dom.node(VirtualDomElements.Span, { ariaHidden: true }, [
                Dom.textNode('/'),
              ]),
              Dom.heading(1, 'BoardTitle', board.name),
            ],
          )
        : Dom.heading(1, 'BoardTitle', 'Boards'),
      ...(board ? [renderBoardSearch(state)] : []),
      ...(board
        ? [
            Dom.div(
              'BoardOverflow',
              [
                Dom.button(
                  'board-options',
                  '…',
                  'BoardButton BoardOptionsButton',
                  {
                    ariaExpanded: Boolean(optionsOpen),
                    ariaLabel: 'More board options',
                    disabled: loading,
                  },
                ),
                ...(optionsOpen
                  ? [
                      Dom.node(
                        VirtualDomElements.Div,
                        {
                          ariaLabel: 'Board options',
                          className: 'BoardOverflowMenu',
                          role: 'group',
                        },
                        [
                          Dom.button(
                            'board-refresh',
                            'Refresh board',
                            'BoardButton',
                            {
                              disabled: loading || Boolean(cardDraft?.saving),
                            },
                          ),
                          Dom.button(
                            'board-change',
                            'Connect another board',
                            'BoardButton',
                          ),
                          Dom.button(
                            'board-disconnect',
                            'Forget board',
                            'BoardButton',
                          ),
                          Dom.button(
                            'board-disconnect-account',
                            'Disconnect Trello',
                            'BoardButton',
                            { disabled: loading },
                          ),
                        ],
                      ),
                    ]
                  : []),
              ],
              { onKeyDown: 'handleDialogKeyDown' },
            ),
          ]
        : []),
    ],
  )
}

const getBoardStyle = (board: TrelloBoard | undefined): string => {
  // The renderer keeps the previous inline style when the next style is empty.
  if (!board)
    return 'background-color:var(--BoardBackground);background-image:none'
  const backgroundImage = board.backgroundImage
    ? `url("${board.backgroundImage}")`
    : board.backgroundGradient
  return [
    board.backgroundColor && `background-color:${board.backgroundColor}`,
    backgroundImage && `background-image:${backgroundImage}`,
  ]
    .filter(Boolean)
    .join(';')
}

const renderCardLabels = (
  labels: TrelloCard['labels'],
): readonly Dom.Node[] => {
  if (!labels?.length) return []
  return [
    Dom.div(
      'BoardCardLabels',
      labels.map((label) =>
        Dom.node(VirtualDomElements.Span, {
          ariaLabel: label.name,
          className: mergeClassNames(
            'BoardCardLabel',
            `BoardCardLabel-${label.color}`,
          ),
          role: 'img',
        }),
      ),
    ),
  ]
}

const renderStatus = (state: BoardState): readonly Dom.Node[] => {
  const { authorizing, discoveringBoards, loading } = state
  if (!loading && !authorizing) return []
  const loadingMessage = discoveringBoards
    ? 'Loading your Trello boards…'
    : 'Loading…'
  return [
    Dom.node(
      VirtualDomElements.Div,
      { className: 'BoardStatus', role: 'status' },
      [
        Dom.textNode(
          authorizing ? 'Waiting for Trello authorization…' : loadingMessage,
        ),
      ],
    ),
  ]
}

const renderCoverAuthorization = (state: BoardState): readonly Dom.Node[] => {
  const { authorizing, authorizingCovers, board } = state
  if (!board?.coverConnectionRequired || (authorizing && !authorizingCovers))
    return []
  return [
    Dom.div(
      'BoardCoverAuthorization',
      authorizationActions(
        state,
        'board-authorize-covers',
        'Connect Trello images',
      ),
    ),
  ]
}

export const render = (state: BoardState, cardDialog?: Dom.Node): Dom.Node => {
  const {
    board,
    boardId,
    discoveringBoards,
    draggedCardId,
    dropTargetId,
    editingCardId,
    loading,
  } = state
  const cards = board?.cards || []
  const cardsByList = new Map<string, Dom.Node[]>()
  for (const card of cards) {
    const cards = cardsByList.get(card.idList) || []
    cards.push(
      Dom.node(
        VirtualDomElements.Button,
        {
          buttonType: 'button',
          className: mergeClassNames(
            cardButtonClass,
            draggedCardId === card.id ? 'BoardCardDragging' : '',
          ),
          draggable: !editingCardId && !loading,
          name: `board-card:${card.id}`,
          onClick: 'handleClick',
          onDragEnd: 'handleBoardDragEnd',
          onDragStart: 'handleBoardDragStart',
          onKeyDown: 'handleDialogKeyDown',
          onPointerDown: 'handleCardPointerDown',
        },
        [
          ...(card.coverImage
            ? [
                Dom.node(VirtualDomElements.Img, {
                  alt: '',
                  className: 'BoardCardCover',
                  loading: 'lazy',
                  referrerPolicy: 'no-referrer',
                  src: card.coverImage.url,
                }),
              ]
            : []),
          ...renderCardLabels(card.labels),
          Dom.div('BoardCardTitle', [Dom.textNode(card.name)]),
          ...renderBadges(card),
        ],
      ),
    )
    cardsByList.set(card.idList, cards)
  }
  const errorNode = renderError(state)
  const setup =
    board || (loading && (boardId || discoveringBoards))
      ? []
      : [renderSetup(state)]
  return Dom.node(
    VirtualDomElements.Div,
    {
      className: mergeClassNames('BoardView', board ? 'BoardViewTrello' : ''),
      style: getBoardStyle(board),
    },
    [
      renderToolbar(state),
      ...(errorNode ? [errorNode] : []),
      ...renderCoverAuthorization(state),
      ...(board
        ? [
            renderColumns(state, board, cardsByList, dropTargetId),
            ...(board.lists.length === 0
              ? [
                  Dom.div('BoardEmpty', [
                    Dom.textNode('This board has no open lists yet.'),
                  ]),
                ]
              : []),
          ]
        : setup),
      ...renderStatus(state),
      ...(cardDialog ? [cardDialog] : []),
    ],
  )
}
