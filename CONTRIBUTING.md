# Contributing to windotwatchr

## Setup

```sh
mise install
bun install --frozen-lockfile
bun --bun run playwright install chromium firefox webkit
```

## Development

```sh
bun run check
bun run build
bun run test:consumers
```

`check` runs types, lint, and Chromium/Firefox/server tests. Linux CI also runs
WebKit, packed consumers with current and minimum supported dependencies, and
both production demos. To check the demos locally:

```sh
bun run build:examples
bun run test:e2e
```

Add focused regressions for bugs. Keep existing behavior tests; avoid tests for
implementation details or additional release paperwork. Describe user-visible
changes in the README and changelog, including known limitations.

## Changes and versions

Use conventional commits (`fix:`, `feat:`, `docs:`, `refactor:`, `test:`, `chore:`).
For changes after 0.3.0, run `bun run changeset` to describe the next release.
Corrections to the unpublished 0.3.0 candidate belong in its existing changelog.

The [version workflow](.github/workflows/version.yml) uses Changesets to create
a version PR. It does not publish. Publishing remains an explicit maintainer
action; merging to main also deploys the examples.

## Release

Review the version and migration notes, then require passing CI. Build and test
the package that will be uploaded:

```sh
bun run build
bun pm pack --ignore-scripts --filename /tmp/windotwatchr-candidate.tgz
bun run test:consumers -- --tarball /tmp/windotwatchr-candidate.tgz
```

CI also checks the minimum consumer profile with Node 18.0.0, React 16.8.0 and
TypeScript 5.5.4. The browser suite exercises readiness, timeout/abort, cleanup,
shared subscriptions and React lifecycle behavior. These checks provide assurance
for supported use; they do not promise every SDK works transparently behind a
Proxy or guarantee background-tab timing. The README explains when to use polling.

### Manual publication with provenance

The [Publish to npm workflow](.github/workflows/release.yml) only runs through
GitHub's **Run workflow** button. Merge the release PR and wait for main's CI to
pass. Select **main**, enter the exact version (for example `0.3.0`), and leave
**Validate without uploading to npm** checked for a dry run. To publish, explicitly
run it again with that checkbox cleared. Merging or pushing a tag never publishes.

The workflow uses Node 24, npm 12.2.0 and Bun, with OIDC instead of an npm token.
It requires successful CI for the selected commit, builds on a GitHub-hosted
runner, checks a packed consumer, and publishes that same archive with provenance.
After upload it compares registry integrity and checks provenance metadata.
A dry run validates packaging but cannot verify OIDC authentication or create an
attestation. If post-upload verification fails, inspect the published version
before retrying; an uploaded npm version cannot be overwritten.

The npm trusted publisher must match GitHub user `juanpprieto`, repository
`windotwatchr`, workflow filename `release.yml`, with no environment name and
**Allow npm publish** enabled. This existing connection was verified as valid on
2026-10-15. Keep bypass-2FA tokens disabled. See npm's
[trusted publishing guidance](https://docs.npmjs.com/trusted-publishers/).

Confirm the npm provenance link and live examples before announcing the release.

Test output and CI results are sufficient; no approval manifest or criterion
ledger is required. `WINDOT_CONSUMER_REPORT` optionally saves a consumer report
outside tracked source when diagnosing a packaging problem.
