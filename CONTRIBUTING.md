# Contributing to windotwatchr

## Setup

```bash
mise install
bun install --frozen-lockfile
bun --bun run playwright install chromium firefox webkit
```

## Development

Run these checks from the repository root before opening a PR:

```bash
bun run check          # typecheck, lint, Chromium/Firefox and server tests
bun run docs:check
bun run check:versioning
bun run build
bun run test:consumers
bun run build:examples
bun run test:e2e
```

On a supported host, also run `bun run test:all` and both
`bun run test:consumers -- --all-browsers` and
`bun run test:consumers:minimum -- --all-browsers`. Linux CI requires WebKit,
the minimum consumer profile and Node 18.0.0 server imports. The default local
suite covers Chromium and Firefox; it does not replace those CI checks.

## Commit conventions

Use [conventional commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `test:` adding/updating tests
- `chore:` tooling, CI, dependencies

## Changesets

If your change is user-facing, add a changeset before opening a PR:

```bash
bun run changeset
```

## Pull requests

- Fill out the PR template
- Run the development checks above and fill out their results in the PR
- Keep PRs focused — one concern per PR

## Release process

Run `bun run changeset -- status --verbose` to inspect pending releases.
`bun run check:versioning` rehearses the version command in a temporary workspace
without changing source versions or publishing. Versioning uses Changesets'
bundled changelog generator and does not need a GitHub token.

The [version workflow](.github/workflows/release.yml) creates a "Version Packages"
PR after changesets reach `main`. It updates versions and the changelog. Merging
that PR does not publish to npm or create a GitHub release; automatic publication
is disabled while the final artifact gate is being completed.

For 0.3.0, maintainers must build and pack the final versioned commit, run the
required checks on that artifact, and obtain independent approval identifying
its commit and tarball digest. Content changes require new validation and
approval. Publication requires separate authorization. See the
[release gates](docs/0.3.0-remediation-roadmap.md#execution-order-and-completion-gates).

### Verify a prepared candidate

Keep the tarball and evidence outside the checkout. From the clean final commit:

```sh
bun run test:consumers -- --all-browsers --tarball /absolute/path/candidate.tgz
bun run test:consumers:minimum -- --all-browsers --tarball /absolute/path/candidate.tgz
bun run test:release-browser -- --tarball /absolute/path/candidate.tgz
bun run verify:release /absolute/path/evidence.json
```

The release-browser check needs a graphical display, such as Xvfb on Linux. It
runs real Next development StrictMode and a hidden Chromium tab with background
throttling allowed. The short smoke test makes no detection deadline guarantee.
Set `WINDOT_CONSUMER_REPORT` and `WINDOT_BROWSER_REPORT` to paths outside the
checkout so reports do not dirty the frozen source.

The evidence manifest records `sourceSha`, `tarball`, SHA-512 `integrity`,
`implementer`, `checks` and `review`. Each required check has `sourceSha`,
`integrity`, `status: "passed"` and an `evidence` path. Review has the same
fingerprint, `status: "approved"`, a distinct `reviewer` and its evidence path.
The verifier checks these records and the actual tarball against the clean
checkout. Maintainers must read the referenced results and reviewer report;
the JSON record is not a signature or a substitute for that review.

Rehearse missing review and mismatched review fingerprints with copies of the
manifest. Both must fail. A failed check or changed candidate returns to
validation and independent review. Verification never invokes a publisher.
After separate authorization, the operator must recheck the preserved bytes,
confirm registry authentication/provenance and publish that exact archive.
Registry integrity, tags and deployed examples are post-publication checks.

The published 0.2.0 package used npm trusted publishing. That historical
configuration does not establish the authentication or provenance of a future
release; those must be verified during publication.

[CODEOWNERS](.github/CODEOWNERS) identifies reviewers. Merge permissions and
required reviews depend on the repository's GitHub settings.
