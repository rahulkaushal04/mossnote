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

You need Node 22.14 or newer. `.nvmrc` has the version used in development. 22.14 is the oldest that can load the SQLite module (it needs Node-API 10). CI runs on Node 22, 24 and 26, and installs the finished npm package on Node 22.14, 22, 24 and 26.

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
- **Web version.** Changes people can see there are checked with `npm run build:standalone` and `npx playwright test --project=standalone` (add `--project=standalone-webkit` for Safari's engine). The web version must never request another site. Changes to how it is built or hosted are also checked with `npm run verify:pages`, which builds it for a GitHub project site and opens it the way Pages serves it (see _Publish the web version_ in the README).
- **Packaging.** Changes to `bin/`, `scripts/package/`, `.github/workflows/binaries.yml`, `package.json` (its `files`, `engines` or dependencies) or `.github/workflows/release.yml` are checked with `npm run package:npm-smoke` (builds the npm tarball, installs it into an empty project, and runs it) and, for the downloadable programs, `npm run package:binary` and `npm run package:smoke`, on your system. They must not add a network call or write outside the data folder. The oldest Node is written in `package.json`, `bin/options.js` and `scripts/package/build-binary.ts`, and `scripts/package/versions.test.ts` fails if they disagree.
- **Python package.** Changes to `python/`, `scripts/python/` or `.github/workflows/pypi.yml` are checked with `npm run build`, `npm run package:python` (needs `pip install build`), then `python python/tests/wheel_smoke.py release/python` (add `--pipx` with pipx installed) and `python -m pytest python/tests`. The launcher passes every argument to `bin/mossnote.js` untouched; do not add options or checks of its own.
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

## Releasing to npm (maintainers)

Nothing publishes by itself. The release workflow (`.github/workflows/release.yml`) publishes the npm package only when the repository variable `PUBLISH_TO_NPM` is `true`. Before the first publish, the maintainer needs:

1. **An npm account that will own the package.** Turn on two-factor authentication. Check the name is still free with `npm view mossnote` (a `404 Not Found` means nobody has it). The first publish claims it. Consider adding a second maintainer with `npm owner add <user> mossnote` so the package is not tied to one account.
2. **A publishing credential, stored as the repository secret `NPM_TOKEN`** (Settings, Secrets and variables, Actions). A granular access token with read and write access to packages, with the option that lets it publish without a one-time code (CI cannot type one). A token cannot be limited to a package that does not exist yet, so the first publish needs a token for all packages. Give it a short expiry, and after the first publish replace it with one limited to `mossnote`. Never put the token in the repository or a log. The longer-term option is npm's trusted publishing: add this repository and the workflow `release.yml` as a trusted publisher in the package's settings on npmjs.com, and the secret is not needed at all. That needs npm 11.5.1 or newer in the job, and the workflow is not set up for it yet.
3. **The variable `PUBLISH_TO_NPM` set to `true`** (same page, Variables tab).
4. **A version you mean to release.** `package.json` says which (the first was `0.1.0-beta.1`). Move the "Unreleased" entries in `CHANGELOG.md` under that version, and make sure `main` is green, including the _npm package_ jobs.
5. **The tag.** `git tag v0.1.0-beta.1` then `git push origin v0.1.0-beta.1`. The tag must be `v` plus the version in `package.json`, or the workflow stops.

The workflow then checks the code, builds the Windows and Linux programs, builds the npm tarball, installs and runs it (`npm run package:npm-smoke`), and publishes that same tarball with provenance. A version with a `-` is a prerelease: the package goes under the dist-tag named after the `-` (so `beta` for `0.1.0-beta.1`) and is never `latest`, and the GitHub release is marked as a prerelease. Do not run `npm publish` by hand.

For a later release, change the version with `npm version <new version> --no-git-tag-version` (it updates `package.json` and the lockfile together), update the changelog, merge, and push the new tag. A version can be published only once, so a fix after a bad publish is a new version.

After it finishes, check from a machine that has never had the repository: `npm view mossnote dist-tags versions`, then `npx mossnote@beta --version` and a real start. The package page on npmjs.com should show the provenance. If a bad version goes out, `npm deprecate mossnote@<version> "<reason>"` is the safe fix; npm only allows removing a version within 72 hours of publishing it.

## The standalone programs (maintainers)

`.github/workflows/binaries.yml` builds the programs (Linux x64, Linux arm64 and Windows x64, each on its own system because the SQLite module is native), runs each one on the system it was built on, and runs the Linux downloads in clean containers: Ubuntu 22.04 and 24.04, Debian 12 and Fedora, on x64 and arm64. It runs by hand (Actions, _Programs_, Run workflow) and on pull requests that touch how they are built, needs no tag, and publishes nothing; it keeps the files as workflow artifacts for 14 days. The release workflow calls it and attaches exactly those files to the draft release. Debian 11, Ubuntu 20.04 and Alpine are also run, as probes that are expected not to work and cannot fail the run.

- **The floor.** On Linux the builder reads the version needs of the Node it embeds and of the SQLite module (`scripts/package/elf.ts`) and fails if they exceed `scripts/package/linux-floor.ts` (glibc 2.34, libstdc++ `GLIBCXX_3.4.29`). Measured on the real files, the SQLite module asks for 2.34 and Node 22 and 24 for 2.28. A test reads the module in `node_modules`, so a dependency update that raises the floor fails the tests until the number and the documentation are changed together.
- **Tarball, not `.deb`, `.rpm` or AppImage.** The program is one self-contained file with no service and nothing to install, and it keeps its data in the user's home. A tarball is enough for that. Packages would add a repository to host and sign, install and uninstall scripts and per-distribution testing, for no benefit a person unpacking one file lacks. An AppImage needs FUSE and suits graphical programs. Revisit this if people ask for a system-wide install or a service.
- **Checks.** `npm run package:checksums` compares every `.sha256` with its file; the release workflow checks them again before the files are attached.
- **Before a tag.** Run _Programs_ by hand on the branch and read the `ubuntu`, `debian` and `fedora` jobs. Nothing in it can publish.

### Code signing

The Windows program is **not signed**. SmartScreen therefore warns on first run, and the documentation says how to check the checksum and proceed. Options, none of them set up:

- **SignPath Foundation** gives open-source projects a free certificate (issued to "SignPath Foundation" as the publisher). Its published conditions (checked when this was written, and at its discretion) include an OSI-approved licence, a project that is maintained and already released, a "certain verifiable reputation" for executables, signing only your own binaries built from source by an automated build, multi-factor authentication for the team, defined author, reviewer and approver roles, a "code signing policy" on the home and download pages, a manual approval for each release, and a product name and version in the file's metadata that match the project. Mossnote is MIT-licensed and builds on GitHub Actions, but eligibility is not assumed: nothing has been applied for, there is no release yet, and the executable currently carries Node.js's own metadata, which would have to be set. Apply once there is a release and some history.
- **A paid certificate or Microsoft's own signing service** also works; their terms and eligibility change, so check them when it matters.

Signing needs the maintainer's application and credentials, and none belongs in the repository.

## Releasing to PyPI (maintainers)

The Python package (`python/`) is one wheel that carries the app from `npm run build`, its production `node_modules` and a launcher. It depends on `nodejs-wheel-binaries` for Node.js. `.github/workflows/pypi.yml` builds it, installs and runs it on Linux, macOS and Windows (`python/tests/wheel_smoke.py`), and publishes it with PyPI's **trusted publishing**: no password or token is stored anywhere. Nothing has to be set up in the repository's secrets. What the maintainer needs:

1. **PyPI and TestPyPI accounts** with two-factor authentication. Check the name is free: `https://pypi.org/project/mossnote/` should say 404 (it did when this was written).
2. **A pending publisher on PyPI** (pypi.org, Your account, Publishing, Add a new pending publisher): project name `mossnote`, owner `rahulkaushal04`, repository `mossnote`, workflow `pypi.yml`, environment `pypi`. Do the same on test.pypi.org with environment `testpypi`. A pending publisher creates the project on its first publish.
3. **Two GitHub environments** (repository Settings, Environments): `pypi` and `testpypi`. Add yourself as a required reviewer on `pypi` if you want a manual approval before anything goes to PyPI.
4. **Try TestPyPI first.** Actions, _PyPI_, Run workflow, repository `testpypi`. Then in a clean machine: `pipx run --pre --index-url https://test.pypi.org/simple/ --pip-args="--extra-index-url https://pypi.org/simple/" mossnote --version`.
5. **PyPI.** Either run the workflow by hand with repository `pypi`, or set the repository variable `PUBLISH_TO_PYPI` to `true` and push the version tag (the same `v0.1.0-beta.1` tag as the npm release). A tag without the variable only builds and tests.

The version is written twice and kept in step by a check: `package.json` says `0.1.0-beta.1` and `python/pyproject.toml` says `0.1.0b1`. `scripts/python/version.ts` converts one into the other (`-alpha.N`, `-beta.N` and `-rc.N` become `aN`, `bN` and `rcN`), a test fails if they disagree, and `npm run package:python` refuses to build. To change the version, run `npm version <new version> --no-git-tag-version` and edit `python/pyproject.toml` to match. PyPI never accepts the same version twice, and a published file cannot be replaced; a bad release is yanked (`pip` then skips it) and the fix is a new version.

When the first version is on PyPI, remove the "not published yet" notes in `README.md` and `docs/content/getting-started.html`.

## Security problems

Do not use a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
