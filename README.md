# Board View Worker

Independent, isolated board worker for [LVCE Editor](https://github.com/lvce-editor/lvce-editor). This npm workspaces monorepo owns board rendering, Trello connections, in-memory sessions, styles and regression tests. It does not import or activate chat-view-2.

- `packages/board-view-worker`: worker source, extension manifest, assets and unit tests.
- `packages/build`: bundle/package scripts, static export and browser integration coverage.
- `packages/e2e`: browser test tooling. The migrated browser scenarios live in `packages/build/src/test-board-selection.ts`.
- `packages/server`: LVCE development workbench.

Use Node from `.nvmrc`, then `npm ci`. Run `npm test`, `npm run type-check`, `npm run lint` and `npm run build`. Install Chromium with `npx playwright install chromium --with-deps`, then run `npm run e2e:headless`. `npm run dev` starts a workbench with only the board worker installed.

The browser suite lives in `packages/e2e` and covers both board routes, reload, discovery, selection, covers, favicons, card editing, drag and drop, search, reconnect, empty/error states and narrow layouts. Only the authenticated backend and Trello HTTP boundaries are mocked; the real workbench loads the worker and renders its DOM. Run `npm run e2e:headless` after installing Chromium.

`npm run knip` checks workspace entry points and dependencies. `.devcontainer/devcontainer.json` uses the Node 26 toolchain from `.nvmrc` and starts the board workbench after container creation.

## Compatibility and integration

The extension is `builtin.board-view`. The entry point is `dist/boardWorkerMain.js`. The stable `chat2.views.board`, `chat2.showBoardLayout` and `chat2.connectedBoardIds` identifiers preserve existing editor commands and saved connections. Board backend configuration reads `Layout.getBackendUrl`, with `chat2.backendUrl` retained as a compatibility override. Tokens come from LVCE's authentication API and are never persisted in board settings or component state. Session data belongs to this isolated worker and survives view disposal.

`npm run build` produces a self-contained npm package in `dist/` and an installable `extension.tar.br` for the editor's built-in extension downloader. No runtime dependency on chat is required. The editor installs chat separately for transitions to AI-native chat and IDE layouts.

## Releases

GitHub Pages deploys the static workbench from `main` at `https://lvce-editor.github.io/board-view-worker/`; the `/board` and `/boards` routes and their assets are exported beneath that repository prefix. The deployment runs only after the Linux, macOS and Windows CI matrix succeeds.

Tag merged main with `vMAJOR.MINOR.PATCH`. The release workflow first creates a draft prerelease, then validates unit/browser suites on Linux, macOS and Windows and builds the worker package. It attaches `board-view-worker-vMAJOR.MINOR.PATCH.tar.br` to the draft and publishes `@lvce-editor/board-view-worker` publicly with provenance. Only after the archive and npm publication succeed does the final job publish the release as a regular latest release. A failed matrix or publication leaves the draft unpublished, so an incomplete release is not presented as a finished public release.

Configure the repository's `NPM_TOKEN` secret with publish access to the `@lvce-editor` scope. After the package exists, configure npm trusted publishing for `lvce-editor/board-view-worker`, workflow `release.yml`, and use OIDC instead.
