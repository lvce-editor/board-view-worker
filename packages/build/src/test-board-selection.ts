// cspell:words prefs

import type { Browser, Page } from 'playwright'
import assert from 'node:assert/strict'

const readBoardBackground = (page: Page) =>
  page.locator('.BoardView').evaluate((element) => {
    const { backgroundColor, backgroundImage } = getComputedStyle(element)
    return { backgroundColor, backgroundImage }
  })

// Exercise the real static workbench and extension event bridge. Only the
// authenticated backend boundary is mocked; no Trello credentials are used.
export const testBoardSelection = async (
  browser: Browser,
  baseUrl: string,
): Promise<void> => {
  const context = await browser.newContext()
  const backend = 'https://trello-selection.test'
  const previewPath =
    '/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa/attachments/dddddddddddddddddddddddd/previews/eeeeeeeeeeeeeeeeeeeeeeee/download/image.png'
  const pastedUrl = 'https://example.com/wiki/Board_(project)?tab=details'
  const autolinkUrl = 'https://example.com/updates'
  const markdownUrl = 'https://example.com/roadmap'
  const description = `# Card notes\n\nA **detailed description** from Trello.\n\nSee (${pastedUrl}), <${autolinkUrl}>, and [the roadmap](${markdownUrl}).\n\n![Design diagram](https://trello.com${previewPath})`
  await context.route(pastedUrl, (route) =>
    route.fulfill({ body: 'Board project', contentType: 'text/plain' }),
  )
  const releaseDetails = Promise.withResolvers<void>()
  const releaseCardRefresh = Promise.withResolvers<void>()
  const releasePhoto = Promise.withResolvers<void>()
  const releaseRevalidation = Promise.withResolvers<void>()
  let holdRevalidation = false
  const releaseImage = Promise.withResolvers<void>()
  const releaseComment = Promise.withResolvers<void>()
  const commentRequests: string[] = []
  let postedComment:
    | {
        data: { text: string }
        date: string
        memberCreator: { fullName: string }
        type: string
      }
    | undefined
  const pastedImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGOUKn7BwMDAxMDAgKAAGzUBe6nlFkgAAAAASUVORK5CYII=',
    'base64',
  )
  const pastedAttachment = {
    name: 'pasted.png',
    url: 'https://example.com/pasted.png',
  }
  const releaseAttachment = Promise.withResolvers<void>()
  let uploadRequests = 0
  let attachmentUploaded = false
  let archiveRequests = 0
  let archived = false
  let detailLoads = 0
  let imageLoads = 0
  let empty = false
  let fail = false
  let connected = true
  const createRequests: { idList: string; name: string }[] = []
  const authPath = '/auth/trello/connect'
  const discoveryLoads: string[] = []
  const proxiedLoads: string[] = []
  const boardLoads: string[] = []
  const coverLoads: string[] = []
  const moveRequests: string[] = []
  const cardEdits: { desc: string; name: string }[] = []
  await context.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === authPath) {
      assert.equal(
        new URL(route.request().url()).searchParams.get('ticket'),
        'reconnect',
      )
      connected = true
      await route.fulfill({
        body: 'Trello connected.',
        contentType: 'text/plain',
      })
      return
    }
    assert.equal(route.request().headers().authorization, 'Bearer board-test')
    let body: unknown
    let status = 200
    if (route.request().method() === 'PUT') {
      const fields = route.request().postDataJSON()
      if (typeof fields?.name === 'string') {
        cardEdits.push(fields)
        body = {
          ...fields,
          id: path.slice(path.lastIndexOf('/') + 1),
          idList: 'bbbbbbbbbbbbbbbbbbbbbbbb',
          pos: 1,
        }
      } else {
        moveRequests.push(path)
        body = {}
      }
    } else if (path.endsWith('/status')) {
      body = { configured: true, connected }
    } else if (path.endsWith('/connect')) {
      assert.equal(route.request().method(), 'POST')
      connected = false
      body = { url: `${backend}${authPath}?ticket=reconnect` }
    } else if (path.endsWith('/cards')) {
      const { idList, name } = route.request().postDataJSON()
      createRequests.push({ idList, name })
      if (createRequests.length === 1) {
        body = { code: 'TRELLO_CREATE_FAILED' }
        status = 403
      } else {
        assert.equal(connected, true, 'Card retry follows Trello authorization')
        body = { id: 'recovered-card', idList, name, pos: 100 }
      }
    } else if (path.endsWith('/token')) {
      body = { accessToken: 'trello-test' }
    } else if (
      /^\/api\/integrations\/trello\/boards\/[^/]+\/covers$/u.test(path)
    ) {
      coverLoads.push(path)
      body = [
        {
          coverDataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmL8AAAAASUVORK5CYII=',
          id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ]
    } else if (/^\/api\/integrations\/trello\/boards\/[^/]+$/u.test(path)) {
      boardLoads.push(path)
      const id = path.split('/').at(-1)
      body = {
        cards: [
          ...(archived
            ? []
            : [
                {
                  badges: {
                    attachments: attachmentUploaded ? 2 : 1,
                    comments: 3,
                  },
                  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
                  idList: 'bbbbbbbbbbbbbbbbbbbbbbbb',
                  labels: [
                    {
                      color: 'yellow',
                      id: 'yellow-label',
                      name: 'In progress',
                    },
                    { color: 'red', id: 'red-label', name: 'Urgent' },
                  ],
                  name: 'Card with cover',
                  pos: 1,
                },
              ]),
          {
            badges: { attachments: 0, comments: 0 },
            id: 'card-2',
            idList: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            name: 'No activity',
            pos: 2,
          },
          ...Array.from({ length: 20 }, (_, index) => ({
            badges: { attachments: 0, comments: 0 },
            id: `long-list-card-${index}`,
            idList: 'dddddddddddddddddddddddd',
            name: `Long list card ${index}`,
            pos: index + 1,
          })),
        ],
        id,
        lists: [
          { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Todo', pos: 1 },
          { id: 'cccccccccccccccccccccccc', name: 'Doing', pos: 2 },
          { id: 'dddddddddddddddddddddddd', name: 'Done', pos: 3 },
        ],
        name: 'Engineering',
        prefs:
          id === '33333333'
            ? {
                backgroundBottomColor: '#ff58b0',
                backgroundTopColor: '#a82be0',
              }
            : {
                backgroundImage:
                  'https://trello-backgrounds.s3.amazonaws.com/engineering.jpg',
              },
      }
    } else {
      proxiedLoads.push(path)
      status = 404
      body = { error: 'Unexpected backend request.' }
    }
    await route.fulfill({ json: body, status })
  })
  await context.route(
    'https://trello-backgrounds.s3.amazonaws.com/**',
    async (route) => {
      await releasePhoto.promise
      await route.fulfill({
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmL8AAAAASUVORK5CYII=',
          'base64',
        ),
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'image/png',
        },
      })
    },
  )
  await context.route('https://api.trello.com/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        headers: {
          'Access-Control-Allow-Headers': 'authorization',
          'Access-Control-Allow-Methods': 'GET, POST, PUT',
          'Access-Control-Allow-Origin': '*',
        },
        status: 204,
      })
      return
    }
    assert.equal(request.headers().authorization, 'Bearer trello-test')
    const url = new URL(request.url())
    if (url.pathname === '/1/search') {
      await route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: {
          boards: [{ id: '22222222', name: 'Engineering' }],
          cards: [
            {
              id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
              idBoard: '22222222',
              name: 'Card with cover',
            },
          ],
        },
      })
      return
    }
    if (url.pathname === '/1/members/me/boards') {
      discoveryLoads.push(`${url.pathname}${url.search}`)
      if (holdRevalidation) await releaseRevalidation.promise
      await route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: empty
          ? []
          : [
              {
                id: '11111111',
                name: 'Design & research',
                prefs: { backgroundColor: '#22a06b' },
              },
              {
                id: '22222222',
                name: holdRevalidation ? 'Engineering updated' : 'Engineering',
                prefs: {
                  backgroundImage:
                    'https://trello-backgrounds.s3.amazonaws.com/engineering.jpg',
                },
              },
              {
                id: '33333333',
                name: 'Long board name with a gradient background',
                prefs: {
                  backgroundBottomColor: '#8b4dc8',
                  backgroundTopColor: '#0c66e4',
                },
              },
            ],
        status: fail ? 503 : 200,
      })
      return
    }
    if (url.pathname === previewPath) {
      imageLoads++
      await releaseImage.promise
      await route.fulfill({
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGOUKn7BwMDAxMDAgKAAGzUBe6nlFkgAAAAASUVORK5CYII=',
          'base64',
        ),
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
      return
    }
    if (url.pathname === '/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa/attachments') {
      assert.equal(request.method(), 'POST')
      const payload = request.postDataBuffer()
      assert.ok(payload)
      const form = await new Response(new Uint8Array(payload), {
        headers: { 'Content-Type': request.headers()['content-type'] || '' },
      }).formData()
      const file = form.get('file')
      assert.ok(file instanceof File)
      assert.equal(file.name, pastedAttachment.name)
      assert.equal(file.type, 'image/png')
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), pastedImage)
      assert.equal(url.searchParams.get('setCover'), 'false')
      const headers = { 'Access-Control-Allow-Origin': '*' }
      if (++uploadRequests === 1) {
        await route.fulfill({ headers, json: {}, status: 400 })
        return
      }
      await releaseAttachment.promise
      attachmentUploaded = true
      await route.fulfill({ headers, json: pastedAttachment })
      return
    }
    if (url.pathname === '/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa/actions/comments') {
      assert.equal(request.method(), 'POST')
      const text = url.searchParams.get('text')
      assert.ok(text)
      commentRequests.push(text)
      const headers = { 'Access-Control-Allow-Origin': '*' }
      if (commentRequests.length === 1) {
        await route.fulfill({ headers, json: {}, status: 503 })
        return
      }
      await releaseComment.promise
      postedComment = {
        data: { text },
        date: new Date().toISOString(),
        memberCreator: { fullName: 'Comment author' },
        type: 'commentCard',
      }
      await route.fulfill({ headers, json: postedComment })
      return
    }
    if (url.pathname === '/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa') {
      if (request.method() === 'PUT') {
        assert.equal(url.searchParams.get('closed'), 'true')
        archived = ++archiveRequests === 2
        await route.fulfill({
          headers: { 'Access-Control-Allow-Origin': '*' },
          json: { closed: archived, id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
          status: archived ? 200 : 503,
        })
        return
      }
      const load = ++detailLoads
      if (load === 2) {
        await releaseCardRefresh.promise
      }
      await releaseDetails.promise
      const activityNow = Date.now()
      await route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: {
          actions: [
            ...(postedComment ? [postedComment] : []),
            {
              data: {
                text:
                  load === 1
                    ? 'Please review the attached design.'
                    : 'The design review is complete.',
              },
              date: new Date(activityNow).toISOString(),
              memberCreator: { fullName: 'Board member' },
              type: 'commentCard',
            },
            {
              data: {},
              date: new Date(activityNow - 60_000).toISOString(),
              memberCreator: { fullName: 'Board member' },
              type: 'createCard',
            },
          ],
          attachments: [
            { name: 'design.png', url: 'https://example.com/design.png' },
            ...(attachmentUploaded ? [pastedAttachment] : []),
          ],
          desc:
            load === 1
              ? description
              : description.replace('Card notes', 'Updated card notes'),
        },
      })
      return
    }
    await route.abort('blockedbyclient')
  })
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) =>
      console.error('Board page error:', error.message),
    )
    const boardOptionsButton = {
      exact: true,
      name: 'More board options',
    }
    const openBoardOptions = async (): Promise<void> => {
      await page
        .getByRole('button', { ...boardOptionsButton, expanded: false })
        .click()
    }
    const bootstrap = new URL('__board-test-bootstrap', baseUrl).href
    await context.route(bootstrap, (route) =>
      route.fulfill({
        body: '<!doctype html><title>Board test setup</title>',
        contentType: 'text/html',
      }),
    )
    await page.goto(bootstrap)
    await page.evaluate(async (backendUrl) => {
      localStorage.setItem(
        'settings',
        JSON.stringify({
          'chat2.backendUrl': backendUrl,
          'chat2.connectedBoardIds': ['22222222'],
          'chat2.useMockBackend': false,
          'layout.backendUrl': backendUrl,
        }),
      )
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('auth-worker', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('auth')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('auth', 'readwrite')
          transaction.objectStore('auth').put(
            JSON.stringify({
              accounts: [
                {
                  backendUrl,
                  id: 'board-test',
                  profile: { displayName: 'Board test', id: 'board-test' },
                  session: {
                    authAccessToken: 'board-test',
                    authAccessTokenExpiresAt: Date.now() + 3_600_000,
                    userState: 'loggedIn',
                  },
                },
              ],
              activeId: 'board-test',
              revision: 1,
            }),
            'accountSessions',
          )
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })
    }, backend)
    await page.goto(baseUrl)
    await page.locator('.Workbench').waitFor()
    const originalIcons = await page
      .locator('head link[rel~="icon"]')
      .evaluateAll((icons) => icons.map((icon) => icon.getAttribute('href')))
    const readBoardIcon = async (photo = false): Promise<string> => {
      await page.waitForFunction(
        (expectPhoto) =>
          [
            ...globalThis.document.querySelectorAll('head link[rel="icon"]'),
          ].some((icon) => {
            const href = icon.getAttribute('href') || ''
            return (
              href.startsWith('data:image/svg+xml,') &&
              (!expectPhoto ||
                decodeURIComponent(href).includes('<image href="data:image/'))
            )
          }),
        photo,
      )
      const href = await page
        .locator('head link[rel="icon"]')
        .getAttribute('href')
      assert.ok(href)
      await page.evaluate(async (src) => {
        const image = globalThis.document.createElement('img')
        image.src = src
        await image.decode()
        if (image.naturalWidth !== 64)
          throw new Error('Expected a 64px board favicon')
      }, href)
      return decodeURIComponent(href.slice(href.indexOf(',') + 1))
    }
    await page.keyboard.press('Control+Shift+P')
    await page.getByRole('combobox').fill('>Open Board Layout')
    await Promise.all([
      page.waitForRequest(
        'https://trello-backgrounds.s3.amazonaws.com/engineering.jpg',
      ),
      page
        .getByRole('option', { exact: true, name: 'View: Open Board Layout' })
        .click(),
    ])
    const tiles = page.locator('.BoardTile')
    await page
      .getByRole('status')
      .filter({ hasText: 'Loading your Trello boards' })
      .waitFor()
    assert.equal(await tiles.count(), 0)
    assert.equal(
      await page.getByRole('searchbox', { name: 'Search boards' }).count(),
      0,
    )
    releasePhoto.resolve()
    try {
      await page.getByRole('button', { name: 'Open Engineering' }).waitFor()
    } catch (error) {
      console.error(
        'Board discovery state:',
        await page.locator('body').innerText(),
        { discoveryLoads, proxiedLoads, boardLoads },
      )
      throw error
    }
    assert.equal(
      await page.locator('button[name="board-provider:trello"]').count(),
      0,
    )
    const listBackground = await readBoardBackground(page)
    assert.equal(await tiles.count(), 3)
    assert.deepEqual(await page.locator('.BoardTileName').allTextContents(), [
      'Design & research',
      'Engineering',
      'Long board name with a gradient background',
    ])
    assert.equal(
      await page
        .locator('.BoardTileBackground')
        .nth(0)
        .evaluate((element) => element.style.backgroundColor),
      'rgb(34, 160, 107)',
    )
    const tilePhoto = page.locator('.BoardTileImage')
    assert.match(
      (await tilePhoto.getAttribute('src')) || '',
      /^data:image\/png;base64,/u,
    )
    await tilePhoto.evaluate((element) =>
      (element as HTMLImageElement).decode(),
    )
    assert.equal(
      await page
        .locator('.BoardTileBackground')
        .nth(2)
        .evaluate((element) => element.style.backgroundImage),
      'linear-gradient(135deg, rgb(12, 102, 228), rgb(139, 77, 200))',
    )
    const boardSearch = page.getByRole('searchbox', { name: 'Search boards' })
    await boardSearch.fill('cover')
    await page
      .getByRole('button', { name: 'Card · Card with cover — Engineering' })
      .waitFor()
    assert.equal(await page.locator('.BoardSearchResult').count(), 2)
    await page.locator('.BoardTitle').click()
    await page.locator('.BoardSearchResults').waitFor({ state: 'hidden' })
    assert.equal(await boardSearch.inputValue(), 'cover')
    await boardSearch.click()
    await page
      .getByRole('button', { name: 'Card · Card with cover — Engineering' })
      .waitFor()
    await boardSearch.press('Tab')
    await page.getByRole('button', { name: 'Board · Engineering' }).waitFor()
    assert.equal(await page.locator('.BoardSearchResult').count(), 2)
    await page.keyboard.press('Enter')
    await page
      .getByRole('heading', { exact: true, name: 'Engineering' })
      .waitFor()
    await boardSearch.fill('')
    assert.equal(discoveryLoads.length, 1)
    assert.equal(new URL(page.url()).hash, '#22222222')
    assert.ok(
      (await readBoardIcon(true)).includes(
        '<image href="data:image/png;base64,',
      ),
    )
    const columns = page.locator('.BoardColumn')
    const emptyColumn = columns.nth(1)
    const longColumn = columns.nth(2)
    const emptyColumnBox = await emptyColumn.boundingBox()
    const shortColumnBox = await columns.nth(0).boundingBox()
    const longColumnBox = await longColumn.boundingBox()
    assert.ok(
      emptyColumnBox &&
        shortColumnBox &&
        longColumnBox &&
        emptyColumnBox.height < shortColumnBox.height &&
        shortColumnBox.height < longColumnBox.height,
      'Empty and short columns fit their contents independently of a longer neighbor',
    )
    assert.ok(
      await longColumn
        .locator('.BoardCards')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
      'Long columns keep their cards in a scrollable list',
    )
    const longCards = longColumn.locator('.BoardCards')
    const addCard = longColumn.getByRole('button', {
      name: 'Add a card to Done',
    })
    const footerBottom = async (): Promise<number> => {
      const box = await addCard.boundingBox()
      assert.ok(box, 'Long-list add control stays visible')
      return box.y + box.height
    }
    const initialFooterBottom = await footerBottom()
    assert.ok(initialFooterBottom < 720, 'Add control fits in the viewport')
    await longCards.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    assert.ok(
      Math.abs((await footerBottom()) - initialFooterBottom) < 2,
      'Scrolling cards does not move the add control',
    )
    await longCards.locator('.BoardCard').last().waitFor({ state: 'visible' })
    await longCards.evaluate((element) => {
      element.scrollTop = 0
    })
    assert.ok(
      (await columns.nth(0).boundingBox())!.height < longColumnBox.height &&
        (await columns.nth(1).boundingBox())!.height < longColumnBox.height,
      'Empty and short columns remain content-sized',
    )
    assert.deepEqual(boardLoads, ['/api/integrations/trello/boards/22222222'])
    assert.equal(
      await page.locator('.BoardViewTrello').evaluate(
        (element) =>
          (
            element as unknown as {
              style: { backgroundImage: string }
            }
          ).style.backgroundImage,
      ),
      'url("https://trello-backgrounds.s3.amazonaws.com/engineering.jpg")',
    )
    await page.reload()
    await page
      .getByRole('heading', { exact: true, name: 'Engineering' })
      .waitFor()
    assert.equal(new URL(page.url()).hash, '#22222222')
    assert.ok(
      (await readBoardIcon(true)).includes(
        '<image href="data:image/png;base64,',
      ),
    )
    assert.deepEqual(boardLoads, [
      '/api/integrations/trello/boards/22222222',
      '/api/integrations/trello/boards/22222222',
    ])
    assert.deepEqual(proxiedLoads, [])
    const cover = page.locator('.BoardCardCover')
    await cover.waitFor({ state: 'visible' })
    assert.deepEqual(coverLoads, [
      '/api/integrations/trello/boards/22222222/covers',
      '/api/integrations/trello/boards/22222222/covers',
    ])
    const coverSrc = await cover.getAttribute('src')
    assert.ok(coverSrc)
    assert.match(coverSrc, /^data:image\/png;base64,/u)
    const labels = page.locator('.BoardCardLabels')
    await labels.waitFor()
    assert.equal(await labels.count(), 1)
    assert.deepEqual(
      await labels.getByRole('img').evaluateAll((elements) =>
        elements.map((element) => ({
          ariaLabel: element.getAttribute('aria-label'),
          className: element.className,
        })),
      ),
      [
        {
          ariaLabel: 'In progress',
          className: 'BoardCardLabel BoardCardLabel-yellow',
        },
        { ariaLabel: 'Urgent', className: 'BoardCardLabel BoardCardLabel-red' },
      ],
    )
    assert.equal(
      await labels.locator('..').evaluate((element) => {
        const children = Array.from(
          element.children,
          (child) => child.className,
        )
        return (
          children.indexOf('BoardCardLabels') <
          children.indexOf('BoardCardTitle')
        )
      }),
      true,
    )
    assert.equal(
      await page
        .locator('.BoardCard')
        .filter({ hasText: 'No activity' })
        .locator('.BoardCardLabels')
        .count(),
      0,
    )
    await page.getByText('Card with cover', { exact: true }).waitFor()
    const badges = page.locator('.BoardCardBadges')
    await badges.waitFor()
    assert.equal(await badges.count(), 1)
    assert.equal(
      await badges
        .getByRole('img', { exact: true, name: '3 comments' })
        .textContent(),
      '3',
    )
    assert.equal(
      await badges
        .getByRole('img', { exact: true, name: '1 attachment' })
        .textContent(),
      '1',
    )
    assert.equal(await page.locator('.BoardCardBadgeIcon').count(), 2)
    const cardButton = page.getByRole('button', {
      exact: false,
      name: 'Card with cover',
    })
    const dialog = page.getByRole('dialog', { name: 'Card details' })
    await cardButton.hover()
    await Promise.all([
      page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname ===
            '/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa' && request.method() === 'GET',
      ),
      page.mouse.down(),
    ])
    assert.equal(await dialog.count(), 0, 'Pointerdown only starts loading')
    assert.equal(await page.getByText('Loading card details…').count(), 0)
    await page.mouse.up()
    const cardHash = '#22222222/card/aaaaaaaaaaaaaaaaaaaaaaaa'
    await page.waitForURL((url) => url.hash === cardHash)
    const cardUrl = page.url()
    await page.getByText('Loading card details…', { exact: true }).waitFor()
    const dialogBeforeDetails = await dialog.count()
    const pendingImage = page.waitForRequest(
      (request) => new URL(request.url()).pathname === previewPath,
    )
    releaseDetails.resolve()
    await pendingImage
    const dialogBeforeImage = await dialog.count()
    releaseImage.resolve()
    assert.equal(dialogBeforeDetails, 0)
    assert.equal(dialogBeforeImage, 0)
    await dialog
      .getByText('Please review the attached design.', { exact: true })
      .waitFor()
    await dialog.getByRole('heading', { name: 'Card notes' }).waitFor()
    await dialog.getByText('A detailed description', { exact: false }).waitFor()
    const image = dialog.locator('.BoardDescriptionImage')
    assert.match(
      (await image.getAttribute('src')) || '',
      /^data:image\/png;base64,/u,
    )
    assert.equal(
      await image.evaluate(async (element) => {
        const img = element as HTMLImageElement
        await img.decode()
        return img.naturalWidth
      }),
      2,
    )
    assert.equal(
      await image.evaluate((element) => element.getBoundingClientRect().height),
      3,
    )
    assert.equal(await dialog.getByLabel('Status: Todo').textContent(), 'Todo')
    const descriptionPreview = dialog.locator('.BoardDescriptionMarkdown')
    assert.equal(await descriptionPreview.count(), 1)
    const pastedLink = descriptionPreview.getByRole('link', {
      exact: true,
      name: pastedUrl,
    })
    assert.equal(await pastedLink.getAttribute('href'), pastedUrl)
    assert.equal(
      await descriptionPreview
        .getByRole('link', { exact: true, name: autolinkUrl })
        .getAttribute('href'),
      autolinkUrl,
    )
    assert.equal(
      await descriptionPreview
        .getByRole('link', { name: 'the roadmap' })
        .getAttribute('href'),
      markdownUrl,
    )
    const [linkedPage] = await Promise.all([
      page.waitForEvent('popup'),
      pastedLink.click(),
    ])
    await linkedPage.getByText('Board project', { exact: true }).waitFor()
    assert.equal(linkedPage.url(), pastedUrl)
    await linkedPage.close()
    const descriptionEdit = dialog.getByRole('button', {
      name: 'Edit',
    })
    assert.equal(
      await descriptionEdit.evaluate((button) => button.getAttribute('type')),
      'button',
    )
    await descriptionEdit.click()
    assert.equal(
      await dialog
        .getByRole('textbox', { name: 'Markdown source' })
        .inputValue(),
      description,
    )
    assert.deepEqual(moveRequests, [])
    await dialog.getByRole('button', { name: 'Preview' }).click()
    assert.equal(
      await dialog
        .getByRole('link', { name: 'design.png' })
        .getAttribute('href'),
      'https://example.com/design.png',
    )
    await dialog.getByText('Created this card', { exact: true }).waitFor()
    await dialog.getByText('Just now', { exact: true }).waitFor()
    await dialog.getByText('1 minute ago', { exact: true }).waitFor()
    await dialog.getByRole('heading', { name: 'Card with cover' }).waitFor()
    assert.equal(
      await dialog.getByRole('textbox', { name: 'Title' }).count(),
      0,
    )
    assert.equal(
      await dialog
        .getByRole('button', { name: /^(Cancel|Save changes)$/u })
        .count(),
      0,
    )
    const dialogBox = await page.locator('.BoardDialog').boundingBox()
    assert.ok(
      dialogBox && dialogBox.width > 900,
      'Card detail uses the full board layout',
    )
    const main = await page.locator('.BoardDialogMain').boundingBox()
    const activity = await page.locator('.BoardDialogActivity').boundingBox()
    assert.ok(
      main && activity && activity.x >= main.x + main.width - 1,
      'Activity is right of description and attachments',
    )
    assert.equal(
      await dialog.evaluate(
        (element) => globalThis.getComputedStyle(element).backgroundColor,
      ),
      'rgba(0, 0, 0, 0.45)',
    )
    if (process.env.BOARD_DETAIL_SCREENSHOT)
      await page.screenshot({ path: process.env.BOARD_DETAIL_SCREENSHOT })
    await page.setViewportSize({ height: 844, width: 390 })
    // Read both sections in one layout snapshot because scroll anchoring
    // can move both of them between separate browser calls.
    const narrowLayout = await dialog.evaluate((element) => {
      const main = element.querySelector('.BoardDialogMain')
      const activity = element.querySelector('.BoardDialogActivity')
      if (!main || !activity) return undefined
      return {
        activityTop: activity.getBoundingClientRect().top,
        mainBottom: main.getBoundingClientRect().bottom,
      }
    })
    assert.ok(
      narrowLayout && narrowLayout.activityTop >= narrowLayout.mainBottom - 1,
      `Activity stacks below details on mobile (viewport=390x844, layout=${JSON.stringify(narrowLayout)})`,
    )
    const panel = await page.locator('.BoardDialog').boundingBox()
    assert.ok(
      panel && panel.x >= 0 && panel.x + panel.width <= 390,
      'Card detail fits mobile',
    )
    if (process.env.BOARD_DETAIL_MOBILE_SCREENSHOT)
      await page.screenshot({
        path: process.env.BOARD_DETAIL_MOBILE_SCREENSHOT,
      })
    await dialog
      .getByRole('button', { name: 'Card with cover', exact: true })
      .click()
    await dialog.getByRole('textbox', { name: 'Title' }).waitFor()
    await dialog.waitFor()
    await page
      .locator('.BoardDialogOverlay')
      .click({ position: { x: 5, y: 5 } })
    await dialog.waitFor({ state: 'detached' })
    await page.waitForURL((url) => url.hash === '#22222222')
    await page.setViewportSize({ height: 720, width: 1280 })
    // Keyboard activation also loads and revalidates cached details.
    await cardButton.focus()
    await Promise.all([
      page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname ===
            '/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa' && request.method() === 'GET',
      ),
      page.keyboard.press('Enter'),
    ])
    await dialog
      .getByText('Please review the attached design.', { exact: true })
      .waitFor()
    await dialog.getByRole('heading', { name: 'Card notes' }).waitFor()
    await page.waitForFunction(
      () =>
        globalThis.document.activeElement?.getAttribute('role') === 'dialog',
    )
    const cachedTitle = dialog.getByRole('button', {
      name: 'Card with cover',
      exact: true,
    })
    assert.equal(await cachedTitle.isDisabled(), true)
    assert.equal(await descriptionEdit.isDisabled(), true)
    releaseCardRefresh.resolve()
    await dialog
      .getByText('The design review is complete.', { exact: true })
      .waitFor()
    await dialog.getByRole('heading', { name: 'Updated card notes' }).waitFor()
    assert.equal(
      await dialog.getByText('Please review the attached design.').count(),
      0,
    )
    assert.equal(detailLoads, 2, 'Each opening makes one card details request')
    assert.equal(await cachedTitle.isEnabled(), true)
    assert.equal(await descriptionEdit.isEnabled(), true)
    assert.equal(imageLoads, 1, 'Revalidation reuses the cached Trello image')

    const commentInput = dialog.getByRole('textbox', {
      name: 'Write a comment',
    })
    const postComment = dialog.getByRole('button', { name: 'Post comment' })
    assert.equal(await postComment.isDisabled(), true)
    await commentInput.fill('   ')
    assert.equal(await postComment.isDisabled(), true)
    const commentText = 'Looks good & ready.\nThanks!'
    await commentInput.fill(`  ${commentText}  `)
    await postComment.click()
    await dialog
      .getByRole('alert')
      .filter({ hasText: 'Trello is temporarily unavailable' })
      .waitFor()
    assert.equal(await commentInput.inputValue(), `  ${commentText}  `)
    await postComment.click()
    assert.equal(
      await dialog.getByRole('button', { name: 'Posting…' }).isDisabled(),
      true,
    )
    assert.equal(
      await dialog.getByText('Comment author', { exact: true }).count(),
      0,
    )
    releaseComment.resolve()
    await dialog.getByText('Comment author', { exact: true }).waitFor()
    assert.equal(
      await dialog.locator('.BoardActivityText').first().textContent(),
      commentText,
    )
    assert.equal(await commentInput.inputValue(), '')
    assert.deepEqual(commentRequests, [commentText, commentText])
    await page.waitForFunction(
      () =>
        globalThis.document.activeElement?.getAttribute('name') ===
        'board-comment-text',
    )

    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await badges.getByRole('img', { exact: true, name: '4 comments' }).waitFor()
    await cardButton.click()
    await dialog.getByText('Comment author', { exact: true }).waitFor()
    assert.equal(
      await dialog.locator('.BoardActivityText').first().textContent(),
      commentText,
    )
    await dialog.getByRole('button', { name: 'Close card' }).click()
    await dialog.waitFor({ state: 'detached' })
    process.stdout.write(
      'Card comments: validation, failed write, retry, activity, badge and reopen: pass\n',
    )
    await cardButton.click()
    await descriptionEdit.click()
    const markdownSource = dialog.getByRole('textbox', {
      name: 'Markdown source',
    })
    const previousDescription = await markdownSource.inputValue()
    const descriptionDraft = `${previousDescription}\n\nUnsaved description`
    await markdownSource.fill(descriptionDraft)
    const paste = (image: boolean): Promise<boolean> =>
      markdownSource.evaluate(
        (element, { bytes, image, name }) => {
          const clipboardData = new DataTransfer()
          if (image) {
            clipboardData.items.add(
              new File([new Uint8Array(bytes)], name, { type: 'image/png' }),
            )
          } else {
            clipboardData.setData('text/plain', 'Ordinary pasted text')
            clipboardData.items.add(
              new File(['sample'], 'notes.txt', { type: 'text/plain' }),
            )
          }
          return element.dispatchEvent(
            new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData,
            }),
          )
        },
        { bytes: [...pastedImage], image, name: pastedAttachment.name },
      )
    assert.equal(await paste(false), true, 'Native text paste is allowed')
    await paste(true)
    await dialog
      .getByRole('alert')
      .filter({ hasText: 'Trello rejected this image' })
      .waitFor()
    assert.equal(uploadRequests, 1, 'Only images are uploaded')
    assert.equal(await markdownSource.inputValue(), descriptionDraft)
    await paste(true)
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Uploading images' })
      .waitFor()
    assert.equal(
      await dialog.getByRole('button', { name: 'Close card' }).isDisabled(),
      true,
    )
    releaseAttachment.resolve()
    const attachmentLink = dialog.getByRole('link', {
      name: pastedAttachment.name,
    })
    await attachmentLink.waitFor()
    assert.equal(
      await attachmentLink.getAttribute('href'),
      pastedAttachment.url,
    )
    assert.equal(await markdownSource.inputValue(), descriptionDraft)
    await markdownSource.fill(previousDescription)
    await dialog.getByRole('button', { name: 'Close card' }).click()
    await dialog.waitFor({ state: 'detached' })
    await badges
      .getByRole('img', { exact: true, name: '2 attachments' })
      .waitFor()
    await cardButton.click()
    await attachmentLink.waitFor()
    await dialog.getByRole('button', { name: 'Close card' }).click()
    await dialog.waitFor({ state: 'detached' })
    process.stdout.write(
      'Card image paste: native text paste, upload failure, retry, draft, badge and reopen: pass\n',
    )
    const draggedCard = page.locator(
      'button[name="board-card:aaaaaaaaaaaaaaaaaaaaaaaa"]',
    )
    const emptyList = page.locator('.BoardCards').nth(1)
    const dragCardToList = async (): Promise<void> => {
      const cardBox = await draggedCard.boundingBox()
      const listBox = await emptyList.boundingBox()
      assert.ok(cardBox && listBox, 'Card and destination list are visible')
      await page.mouse.move(
        cardBox.x + cardBox.width / 2,
        cardBox.y + cardBox.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        cardBox.x + cardBox.width / 2 + 20,
        cardBox.y + cardBox.height / 2,
        { steps: 3 },
      )
      await page.mouse.move(
        listBox.x + listBox.width / 2,
        listBox.y + listBox.height / 2,
        { steps: 5 },
      )
    }
    for (let index = 0; index < 2; index++) {
      await dragCardToList()
      await page.locator('.BoardCardsDropTarget').waitFor()
      assert.equal(
        await draggedCard.evaluate((element) =>
          element.className.includes('BoardCardDragging'),
        ),
        true,
      )
      await page.keyboard.press('Escape')
      await page.locator('.BoardCardsDropTarget').waitFor({ state: 'detached' })
      await page.mouse.up()
      assert.equal(
        await draggedCard.evaluate((element) =>
          element.className.includes('BoardCardDragging'),
        ),
        false,
      )
    }
    await dragCardToList()
    await page.locator('.BoardCardsDropTarget').waitFor()
    await page.mouse.move(5, 5)
    await page.mouse.up()
    await page.locator('.BoardCardsDropTarget').waitFor({ state: 'detached' })
    assert.deepEqual(moveRequests, [])
    assert.equal(
      await page.locator('.BoardCards').first().locator(draggedCard).count(),
      1,
    )
    await dragCardToList()
    await page.locator('.BoardCardsDropTarget').waitFor()
    const moved = page.waitForResponse(
      (response) => response.request().method() === 'PUT',
    )
    await page.mouse.up()
    await moved
    await page.locator('.BoardCardsDropTarget').waitFor({ state: 'detached' })
    assert.equal(await emptyList.locator(draggedCard).count(), 1)
    assert.deepEqual(moveRequests, [
      '/api/integrations/trello/cards/aaaaaaaaaaaaaaaaaaaaaaaa/list/cccccccccccccccccccccccc',
    ])
    await page
      .getByText('Loading…', { exact: true })
      .waitFor({ state: 'detached' })
    assert.equal(
      await page.evaluate(async () => {
        const cache = await globalThis.caches.open(
          'builtin.board-view.card-details-v1',
        )
        return (
          await cache.matchAll(
            'https://api.trello.com/1/cards/aaaaaaaaaaaaaaaaaaaaaaaa',
            { ignoreSearch: true },
          )
        ).length
      }),
      0,
      'Moving invalidates cached activity',
    )
    await draggedCard.click()
    await dialog.getByLabel('Status: Doing').waitFor()
    assert.equal(imageLoads, 1, 'Moving a card keeps its cached image')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    process.stdout.write(
      'Card details: pointerdown, staged opening, stale-while-revalidate, cache invalidation, layout and dismissal: pass\n',
    )
    const title = page.getByRole('textbox', { exact: true, name: 'Card title' })
    for (const list of ['Todo', 'Doing', 'Todo']) {
      await page
        .locator(`.BoardAddCard[aria-label="Add a card to ${list}"]`)
        .click()
      await title.waitFor()
      await page.waitForFunction(
        () =>
          globalThis.document.activeElement?.getAttribute('name') ===
          'board-card-title',
        undefined,
        { timeout: 3000 },
      )
      await page.keyboard.press('N')
      await page.waitForFunction(
        (value) =>
          globalThis.document.querySelector<HTMLInputElement>(
            'input[name="board-card-title"]',
          )?.value === value,
        'N',
      )
      assert.equal(await title.inputValue(), 'N')
      await title.blur()
      await openBoardOptions()
      await page
        .getByRole('button', { ...boardOptionsButton, expanded: true })
        .waitFor()
      assert.equal(await title.inputValue(), 'N')
      await page
        .locator('.BoardCardComposer')
        .getByRole('button', {
          exact: true,
          name: 'Cancel',
        })
        .click()
      await title.waitFor({ state: 'detached' })
      await page
        .locator(`.BoardAddCard[aria-label="Add a card to ${list}"]`)
        .waitFor()
      await openBoardOptions()
      const refreshButton = page.getByRole('button', {
        exact: true,
        name: 'Refresh board',
      })
      const refreshed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          '/api/integrations/trello/boards/22222222',
      )
      await refreshButton.click()
      await refreshed
      await openBoardOptions()
      await page.waitForFunction(() => {
        const button = globalThis.document.querySelector<HTMLButtonElement>(
          'button[name="board-refresh"]',
        )
        return button && !button.disabled
      })
      assert.equal(await title.count(), 0)
      await page
        .getByRole('button', { ...boardOptionsButton, expanded: true })
        .click()
    }
    process.stdout.write('Add card focuses title on open and reopen: pass\n')
    await openBoardOptions()
    const refresh = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname ===
          '/api/integrations/trello/boards/22222222',
    )
    await page
      .getByRole('button', { exact: true, name: 'Refresh board' })
      .click()
    await refresh
    assert.equal(boardLoads.length, 6)
    assert.deepEqual(proxiedLoads, [])
    await openBoardOptions()
    await page
      .getByRole('button', { exact: true, name: 'Connect another board' })
      .click()
    await page.waitForFunction(() =>
      [...globalThis.document.querySelectorAll('head link[rel="icon"]')].every(
        (icon) => !icon.getAttribute('href')?.startsWith('data:image/svg+xml,'),
      ),
    )
    assert.deepEqual(
      await page
        .locator('head link[rel~="icon"]')
        .evaluateAll((icons) => icons.map((icon) => icon.getAttribute('href'))),
      originalIcons,
    )
    empty = true
    await page
      .getByRole('button', { exact: true, name: 'Connect Trello' })
      .click()
    await page.getByText('No open boards found.', { exact: false }).waitFor()
    const rememberedTile = page.locator(
      '.BoardRemembered button[name="board-select:22222222"]',
    )
    assert.equal(await rememberedTile.innerText(), '22222222')
    assert.equal(await rememberedTile.getAttribute('class'), 'BoardTile')
    assert.equal(
      await rememberedTile.getAttribute('aria-label'),
      'Open remembered board 22222222',
    )
    await page.setViewportSize({ height: 844, width: 390 })
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    let rememberedTileFocused = false
    for (let index = 0; index < 100 && !rememberedTileFocused; index++) {
      await page.keyboard.press('Tab')
      rememberedTileFocused = await rememberedTile.evaluate(
        (element) => globalThis.document.activeElement === element,
      )
    }
    assert.equal(
      rememberedTileFocused,
      true,
      'Remembered board is keyboard reachable',
    )
    assert.equal(
      await rememberedTile.evaluate(
        (element) => globalThis.getComputedStyle(element).outlineStyle,
      ),
      'solid',
    )
    const rememberedTileBox = await rememberedTile.boundingBox()
    assert.ok(
      rememberedTileBox &&
        rememberedTileBox.x >= 0 &&
        rememberedTileBox.x + rememberedTileBox.width <= 390,
      'Remembered board tile fits a narrow viewport',
    )
    if (process.env.BOARD_REMEMBERED_SCREENSHOT)
      await page.screenshot({ path: process.env.BOARD_REMEMBERED_SCREENSHOT })
    await page.setViewportSize({ height: 720, width: 1280 })
    fail = true
    await page
      .getByRole('button', { exact: true, name: 'Refresh boards' })
      .click()
    await page.getByRole('alert').waitFor()
    fail = false
    empty = false
    await page.getByRole('button', { exact: true, name: 'Try again' }).click()
    await page.getByRole('alert').waitFor({ state: 'detached' })
    await page.waitForFunction(() => {
      return globalThis.document.querySelectorAll('.BoardTile').length === 3
    })
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await page.locator('.BoardTile').count(), 3)
    await page.setViewportSize({ height: 844, width: 390 })
    if (process.env.BOARD_SELECTION_SCREENSHOT)
      await page.screenshot({ path: process.env.BOARD_SELECTION_SCREENSHOT })
    const box = await page.locator('.BoardTileGrid').boundingBox()
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 390,
      'Board selector fits a narrow viewport',
    )
    await page
      .getByRole('button', {
        name: 'Open Long board name with a gradient background',
      })
      .click()
    await page
      .getByRole('heading', { exact: true, name: 'Engineering' })
      .waitFor()
    assert.equal(
      await page.locator('.BoardViewTrello').evaluate(
        (element) =>
          (
            element as unknown as {
              style: { backgroundImage: string }
            }
          ).style.backgroundImage,
      ),
      'linear-gradient(135deg, rgb(168, 43, 224), rgb(255, 88, 176))',
    )
    assert.equal(
      await page.locator('.BoardViewTrello').evaluate(
        (element) =>
          (
            element as unknown as {
              style: { backgroundColor: string }
            }
          ).style.backgroundColor,
      ),
      'rgb(255, 88, 176)',
    )
    await page.getByRole('button', { name: 'More board options' }).focus()
    await page.keyboard.press('Shift+Tab')
    assert.ok(
      await boardSearch.evaluate(
        (element) =>
          globalThis.getComputedStyle(element).outlineStyle === 'solid',
      ),
      'The toolbar search is reachable by keyboard with visible focus',
    )
    await boardSearch.fill('cover')
    await page
      .getByRole('button', { name: 'Card · Card with cover — Engineering' })
      .waitFor()
    const searchResults = page.locator('.BoardSearchResults')
    const toolbar = page.locator('.BoardToolbar')
    for (const width of [390, 601, 1280]) {
      await page.setViewportSize({ height: 844, width })
      const bounds = await searchResults.boundingBox()
      const toolbarBounds = await toolbar.boundingBox()
      assert.ok(
        bounds &&
          toolbarBounds &&
          bounds.x >= toolbarBounds.x &&
          bounds.x + bounds.width <= toolbarBounds.x + toolbarBounds.width,
        `Search results fit in a ${width}px viewport`,
      )
    }
    const gradientIcon = await readBoardIcon()
    assert.ok(gradientIcon.includes('stop-color="#a82be0"'))
    assert.ok(gradientIcon.includes('stop-color="#ff58b0"'))
    await page
      .getByRole('button', { exact: true, name: 'Add a card to Todo' })
      .click()
    const draft = 'Retained Trello draft'
    await title.fill(draft)
    const add = page.getByRole('button', { exact: true, name: 'Add card' })
    await add.click()
    const reconnect = page.getByRole('button', {
      exact: true,
      name: 'Reconnect Trello',
    })
    await reconnect.waitFor()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Trello denied access to add this card' })
      .waitFor()
    assert.equal(await title.inputValue(), draft)
    const composer = page.locator('.BoardCardComposer')
    const composerBox = await composer.boundingBox()
    const reconnectBox = await reconnect.boundingBox()
    assert.ok(
      composerBox &&
        reconnectBox &&
        reconnectBox.x >= composerBox.x &&
        reconnectBox.x + reconnectBox.width <=
          composerBox.x + composerBox.width,
      'Reconnect fits inside the composer at a narrow viewport',
    )
    if (process.env.BOARD_RECONNECT_SCREENSHOT)
      await page.screenshot({ path: process.env.BOARD_RECONNECT_SCREENSHOT })
    await title.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    const continueToTrello = page.getByRole('link', {
      name: 'Continue to Trello',
    })
    await continueToTrello.waitFor()
    assert.equal(await add.isDisabled(), true)
    await page.getByRole('button', { name: 'Stop waiting' }).click()
    await reconnect.waitFor()
    assert.equal(await title.inputValue(), draft)
    assert.equal(createRequests.length, 1)
    await reconnect.click()
    const authorized = context.waitForEvent('page')
    await continueToTrello.click()
    const authorizationTab = await authorized
    await authorizationTab.getByText('Trello connected.').waitFor()
    await authorizationTab.close()
    await continueToTrello.waitFor({ state: 'detached' })
    assert.equal(await title.inputValue(), draft)
    assert.equal(
      createRequests.length,
      1,
      'Reconnecting does not submit the draft',
    )
    await add.click()
    await page.getByRole('button', { name: draft }).waitFor()
    assert.deepEqual(createRequests, [
      { idList: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: draft },
      { idList: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: draft },
    ])
    process.stdout.write('Add card recovers from Trello write denial: pass\n')

    // Search from a different board and open the copied card URL in a new tab.
    await boardSearch.fill('cover')
    const cardResult = page.getByRole('button', {
      name: 'Card · Card with cover — Engineering',
    })
    await cardResult.click()
    await page.waitForURL((url) => url.hash === cardHash)
    await dialog.getByRole('button', { name: 'Close card' }).click()
    await page.waitForURL((url) => url.hash === '#22222222')

    const directPage = await context.newPage()
    const deepLink = new URL(cardUrl)
    deepLink.searchParams.set('card-url-test', 'retained')
    await directPage.goto(deepLink.href)
    const directDialog = directPage.getByRole('dialog', {
      name: 'Card details',
    })
    const titleButton = directDialog.getByRole('button', {
      name: 'Card with cover',
      exact: true,
    })
    await titleButton.waitFor()
    await directPage.reload()
    await titleButton.and(directPage.locator('button:enabled')).waitFor()
    await titleButton.focus()
    await directPage.keyboard.press('Enter')
    const directTitle = directDialog.getByRole('textbox', { name: 'Title' })
    assert.equal(await directTitle.inputValue(), 'Card with cover')
    await directTitle.fill('Renamed card')
    const savedTitle = directPage.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith(
          '/cards/aaaaaaaaaaaaaaaaaaaaaaaa',
        ),
    )
    await directTitle.blur()
    assert.equal((await savedTitle).ok(), true)
    await directDialog.getByRole('heading', { name: 'Renamed card' }).waitFor()
    await directDialog
      .getByText('Saving…', { exact: true })
      .waitFor({ state: 'detached' })
    assert.deepEqual(cardEdits, [
      {
        desc: description.replace('Card notes', 'Updated card notes'),
        name: 'Renamed card',
      },
    ])
    await directPage
      .locator('button[name="board-card:aaaaaaaaaaaaaaaaaaaaaaaa"]')
      .filter({ hasText: 'Renamed card' })
      .waitFor()
    await directDialog.getByRole('button', { name: 'Close card' }).click()
    await directPage.waitForURL((url) => url.hash === '#22222222')
    const boardUrl = new URL(directPage.url())
    assert.equal(boardUrl.pathname, deepLink.pathname)
    assert.equal(boardUrl.search, deepLink.search)
    await directDialog.waitFor({ state: 'detached' })
    await directPage.setViewportSize({ height: 844, width: 390 })
    const breadcrumb = directPage.getByRole('navigation', {
      name: 'Breadcrumb',
    })
    const boardHeading = breadcrumb.getByRole('heading', {
      level: 1,
      name: 'Engineering',
    })
    const boardsButton = breadcrumb.getByRole('button', {
      exact: true,
      name: 'Boards',
    })
    await boardHeading.waitFor()
    const headingFont = await boardHeading.evaluate((heading) => {
      const { fontSize, fontWeight } = getComputedStyle(heading)
      return { fontSize, fontWeight }
    })
    assert.deepEqual(
      await boardsButton.evaluate((button) => {
        const { fontSize, fontWeight } = getComputedStyle(button)
        return { fontSize, fontWeight }
      }),
      headingFont,
      'Boards and the current board title share the same typography',
    )
    const cardTile = directPage.locator(
      'button[name="board-card:aaaaaaaaaaaaaaaaaaaaaaaa"]',
    )
    await cardTile.click()
    const cardActions = directDialog.getByRole('button', {
      name: 'More card actions',
    })
    const actionPanel = directDialog.getByRole('group', {
      name: 'Card actions',
    })
    await cardActions.focus()
    await directPage.keyboard.press('Enter')
    await actionPanel.waitFor()
    await directPage.keyboard.press('Escape')
    await actionPanel.waitFor({ state: 'detached' })
    assert.equal(
      await cardActions.evaluate((button) => button === document.activeElement),
      true,
    )
    await cardActions.click()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await actionPanel.getByRole('button', { name: 'Copy card link' }).click()
    await directDialog.getByText('Card link copied.', { exact: true }).waitFor()
    assert.equal(
      await directPage.evaluate(() =>
        globalThis.navigator.clipboard.readText(),
      ),
      deepLink.href,
    )
    await cardActions.click()
    assert.ok(
      await actionPanel.evaluate((panel) => {
        const bounds = panel.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= globalThis.innerWidth
      }),
    )
    await actionPanel.getByRole('button', { name: 'Move to list' }).click()
    await actionPanel
      .getByRole('button', { exact: true, name: 'Doing' })
      .click()
    await directDialog.getByLabel('Status: Doing').waitFor()
    assert.equal(
      await directPage.locator('.BoardCards').nth(1).locator(cardTile).count(),
      1,
    )
    await cardActions.click()
    await actionPanel.getByRole('button', { name: 'Archive card' }).click()
    await directDialog
      .getByRole('alert')
      .getByText('Trello is temporarily unavailable.', { exact: false })
      .waitFor()
    assert.equal(await cardTile.count(), 1)
    await cardActions.click()
    await actionPanel.getByRole('button', { name: 'Archive card' }).click()
    await directDialog.waitFor({ state: 'detached' })
    await cardTile.waitFor({ state: 'detached' })
    await directPage.waitForURL((url) => url.hash === '#22222222')
    await directPage.reload()
    await directPage.getByRole('button', { name: 'No activity' }).waitFor()
    assert.equal(await cardTile.count(), 0)
    assert.equal(archiveRequests, 2)
    process.stdout.write(
      'Card actions: keyboard dismissal, copy link, move and archive with retry: pass\n',
    )
    await directPage.getByRole('searchbox', { name: 'Search boards' }).focus()
    await directPage.keyboard.press('Shift+Tab')
    assert.ok(
      await boardsButton.evaluate(
        (button) =>
          button === globalThis.document.activeElement &&
          globalThis.getComputedStyle(button).outlineStyle === 'solid',
      ),
      'Boards is keyboard reachable with visible focus',
    )
    await directPage.keyboard.press('Enter')
    await directPage
      .getByRole('button', { name: 'Open Engineering', exact: true })
      .waitFor()
    assert.equal(await breadcrumb.count(), 0)
    assert.equal(
      directPage.url(),
      new URL(deepLink.pathname + deepLink.search, deepLink).href,
    )
    assert.deepEqual(
      await readBoardBackground(directPage),
      listBackground,
      'Returning from board detail restores the boards list background',
    )
    await directPage.close()
    process.stdout.write(
      'Card URLs: click, search, direct navigation, reload and dismissal: pass\n',
    )

    holdRevalidation = true
    await Promise.all([
      page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === '/1/members/me/boards' &&
          request.method() === 'GET',
      ),
      page.goto(new URL('board/', baseUrl).href),
    ])
    await page
      .getByRole('button', { name: 'Open Engineering', exact: true })
      .waitFor()
    await tilePhoto.evaluate((element) =>
      (element as HTMLImageElement).decode(),
    )
    releaseRevalidation.resolve()
    await page
      .getByRole('button', { name: 'Open Engineering updated', exact: true })
      .waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Open Engineering', exact: true })
        .count(),
      0,
    )
    process.stdout.write(
      'Board picker restores photos before revalidation and applies updated Trello boards: pass\n',
    )
    process.stdout.write(
      'standalone Trello discovery, board favicons, clickable board tiles, empty state and retry: pass\n',
    )

    archived = false
    holdRevalidation = false
    const homeUrl = new URL('?test-board-route=retained', baseUrl)
    await page.goto(homeUrl.href)
    const boardsTab = page.getByRole('tab', { exact: true, name: 'Boards' })
    if ((await boardsTab.getAttribute('aria-selected')) !== 'true')
      await boardsTab.click()
    await page
      .getByRole('button', { exact: true, name: 'Open Engineering' })
      .click()

    const homeBoardUrl = new URL('boards/', baseUrl)
    homeBoardUrl.search = homeUrl.search
    homeBoardUrl.hash = '#22222222'
    await page.waitForURL(homeBoardUrl.href)
    await page.reload()
    await page
      .getByRole('heading', { exact: true, name: 'Engineering' })
      .waitFor()

    await cardButton.click()
    const cardDetailUrl = new URL(homeBoardUrl)
    cardDetailUrl.hash = cardHash
    await page.waitForURL(cardDetailUrl.href)
    await page.reload()
    await dialog
      .getByRole('button', { exact: true, name: 'Card with cover' })
      .waitFor()
    await dialog.getByRole('button', { name: 'Close card' }).click()
    await page.waitForURL(homeBoardUrl.href)
    process.stdout.write(
      'Standalone homepage: board and card URLs survive reload\n',
    )
  } finally {
    releaseDetails.resolve()
    releaseCardRefresh.resolve()
    releaseImage.resolve()
    releasePhoto.resolve()
    releaseRevalidation.resolve()
    await context.close()
  }
}
