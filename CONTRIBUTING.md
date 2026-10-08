# Contributing to Mossnote

Thanks for wanting to help. Mossnote is small on purpose, and a few rules keep it that way, so please read this before you write any code.

## The two rules that matter most

**1. Open an issue first.** Check your idea against the ["What it will not do"](README.md#what-it-will-not-do) list in the README. If it is on that list it will be closed. Those are decisions, not a backlog.

**2. Do not add game content.** This rule has no exceptions. The app can only promise "no spoilers" if nothing about any game is ever in it. That means no names, items, places, mechanics, images, text or screenshots from a game, whether in code, tests, fixtures, copy or docs. In tests, use neutral filler such as "Example Person".

A game template (the files in `src/shared/templates/`) may carry the game's name and plain vocabulary, like what a section is called, and nothing that teaches how the game works. Two templates ship: Default and Stardew Valley. Open a feature request before writing another one.

## Ways to help

- **Report a bug** with the [bug report form](https://github.com/rahulkaushal04/mossnote/issues/new?template=bug_report.yml). Use made-up data, never your real journal.
- **Suggest a feature** with the [feature request form](https://github.com/rahulkaushal04/mossnote/issues/new?template=feature_request.yml).
- **Fix something.** Pick an open issue, say you are working on it, then send a pull request.
- **Improve the docs.** Fixes to wording and typos are welcome without an issue.

## Set up

You need Node 22.12 or newer. `.nvmrc` has the version used in development.

```bash
git clone https://github.com/rahulkaushal04/mossnote.git
cd mossnote
nvm use                           # optional
npm install
npx playwright install chromium   # once, for the end-to-end tests
npm run dev
```

`npm run dev` starts the API on port 4317 and Vite on 5173. Its data lives in `./.dev-data`, so it never touches your real journal. That folder starts empty, so the first screen is "Which template?". Set `MOSS_JOURNAL` to skip it.

## Make a change

1. Fork the repository and create a branch from `main`.
2. Make a small change that does one thing.
3. Run the checks below.
4. Open a pull request and fill in the template.

### Checks

CI runs these too.

```bash
npm run check          # lint, typecheck, unit and integration tests
npm run format:check
npm run test:e2e       # for anything a person can see or click
```

### Checklist

- **Small.** Several small pull requests beat one big one.
- **Tested.** Add tests at the lowest layer that proves the change: unit, integration, component, or end to end for things a person can see. A bug fix starts with a test that fails.
- **Accessible.** Anything a person can use works with the keyboard alone and passes the axe scans in both the light and dark theme.
- **Looks right.** Colours, sizes, radii and motion come from the tokens in `src/web/styles/tokens.css`, with no raw hex values or one-off pixel sizes in components. A new colour pair is added to `src/web/styles/contrast.test.ts` first. Check the change at 375, 768 and 1280 px in light and dark. Controls must be reachable by keyboard and touch (44 px on touch, a visible focus ring, nothing that only shows on hover).
- **Dependencies.** A new dependency needs a short reason in the pull request: why you need it and what else you looked at.
- **Database.** A schema change comes with a migration, tested forward from the previous schema. Generate it with `npm run db:generate` and never edit generated files by hand. A change to how journals are opened, listed or named also needs a test in `src/server/upgrade.test.ts`.
- **Runs in both places.** The server code also runs in the browser (the web version). Code in `src/server/services`, `src/server/app.ts` and the portable parts of `src/server/db` must not use Node APIs. Put anything that needs files behind the `Sqlite` and `Storage` interfaces. Changes to the database, snapshots or journals must also pass `npm run test:wasm`.
- **Web version.** Changes people can see there are checked with `npm run build:standalone` and `npx playwright test --project=standalone` (add `--project=standalone-webkit` for Safari's engine). The web version must never request another site.
- **Packaging.** Changes to `bin/`, `scripts/package/` or `.github/workflows/release.yml` are checked with `npm run package:binary` and `npm run package:smoke` on your system. They must not add a network call or write outside the data folder.
- **Docs.** Update the README if something a user can see changed. Leave `CHANGELOG.md` for the maintainer.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): a type, an optional scope, and a short summary in the imperative.

```text
feat(server): add snapshot retention
fix(maps): keep the quick bar clear of the turn handle
docs: explain how snapshots are restored
```

Common types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs` and `chore`. Keep refactors in their own commits, apart from behaviour changes, so a reviewer can check that nothing changed.

## Code style

Explain why, not what. Name things after the problem they solve. Keep logic in pure functions and components thin. The project uses npm, ESM and strict TypeScript.

ESLint enforces the import boundaries between `src/shared`, `src/server`, `src/standalone` and `src/web`. If a rule blocks you, the code is probably in the wrong place. Move it rather than turning the rule off.

## How a pull request is reviewed

This is a volunteer project, so reviews can take a while. Expect questions. If changes are requested, it is about the code and not about you. A pull request that goes quiet for a few weeks may be closed, and you are welcome to reopen it.

## Security problems

Do not use a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
