# Contributing to Mossnote

Thanks for wanting to help. Mossnote is small on purpose, and a few rules keep it that way, so please read this before you write any code.

## The two rules that matter most

**1. Open an issue first.** Check your idea against the "What it will not do" list in the [README](README.md#what-it-will-not-do). If it is on that list it will be closed. Those are decisions, not a backlog.

**2. Do not add game content.** This is the one rule with no exceptions. The app can only promise "no spoilers" if nothing about any game is ever in it. That means no names, items, places, mechanics, images, text or screenshots from a game, whether in code, tests, fixtures, copy or docs. In tests, use neutral filler such as "Example Person". A game template (the files in `src/shared/templates/`) may carry the game's name and plain vocabulary, like what a section is called, and nothing that teaches how the game works. Two templates ship, Default and Stardew Valley. Open a feature request before writing another one; the app links to that form wherever a template is picked.

## Getting set up

You need Node 22 or newer. The version in `.nvmrc` is the one I use.

```bash
nvm use
npm install
npx playwright install chromium
npm run dev
```

`npm run dev` starts the API on port 4317 and Vite on 5173, and keeps its data in `./.dev-data`, so it never touches your real journal. Its data folder starts empty, so the first thing you see is the "Which template?" question; set `MOSS_JOURNAL` to skip it.

## Before you open a pull request

Run these. CI runs them too.

```bash
npm run check        # lint, typecheck, unit and integration tests
npm run format:check
npm run test:e2e     # for anything a person can see or click
```

Then go through this list:

- The change is small and does one thing. Several small pull requests beat one big one.
- It has tests at the lowest layer that proves it: unit, integration, component, or end to end for things a person can see. A bug fix starts with a test that fails.
- Anything a person can use works with the keyboard alone and passes the axe accessibility scans in both the light and dark theme.
- Anything that changes how the app looks follows `local_docs_reference/design-system.md`: colours, sizes, radii and motion come from the tokens in `src/web/styles/tokens.css` (no raw hex values or one-off pixel sizes in components), and a new colour pair is added to `src/web/styles/contrast.test.ts` first. Look at the change at 375, 768 and 1280 px, in light and dark, and keep every control reachable by keyboard and touch (44 px on touch, a visible focus ring, nothing that only shows on hover).
- A new dependency needs a short written reason in the pull request: why you need it and what else you looked at.
- A schema change comes with a migration, and the migration is tested forward from the previous schema. Generate it with `npm run db:generate` and do not edit generated files by hand. The upgrade tests (`src/server/upgrade.test.ts`) open a journal from every older schema automatically; a change that touches how journals are opened, listed or named needs a test there too.
- Anything that touches the database, snapshots or journals also passes `npm run test:wasm`, which runs the server's tests on SQLite in WebAssembly (what the web version uses). Code in `src/server/services`, `src/server/db` (except `client.ts`, `backup.ts`, `catalog.ts`, `migrate.ts`, `folderStorage.ts`) and `src/server/app.ts` must stay free of Node APIs: use the `Sqlite` and `Storage` interfaces, and put anything that needs files behind them.
- Anything a person can see in the web version (`npm run build:standalone`) is checked with `npx playwright test --project=standalone` (and `--project=standalone-webkit` for Safari's engine). The web version must make no request to any other site.
- Anything that changes how the program is packaged or released (`bin/`, `scripts/package/`, `.github/workflows/release.yml`) is checked with `npm run package:binary` and `npm run package:smoke` on your own system, and must not add a network call or write outside the data folder.
- The README is updated if behaviour a user can see has changed. Leave `CHANGELOG.md` alone, the maintainer keeps it.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): a type, an optional scope, and a short summary in the imperative.

```text
feat(server): add snapshot retention
fix(maps): keep the quick bar clear of the turn handle
docs: explain how snapshots are restored
```

Common types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs` and `chore`. Keep refactors in their own commits, apart from changes in behaviour, so a reviewer can check that nothing changed.

## Code style

The short version of the code style: explain why and not what, name things after the problem they solve, keep logic in pure functions, and keep components thin.

The project uses npm, ESM and strict TypeScript. ESLint enforces the import boundaries between `src/shared`, `src/server` and `src/web`. If a rule blocks you, the code is probably in the wrong place. Move it rather than turning the rule off.

## How a pull request is reviewed

I read every one, but this is a hobby project, so it can take a while. Expect questions. If I ask for changes, it is about the code and not about you. If a pull request goes quiet for a few weeks I may close it, and you are welcome to reopen it later.

## Reporting a security problem

Do not use a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
