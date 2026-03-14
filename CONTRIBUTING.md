# Contributing to windotwatchr

## Setup

```bash
pnpm install
```

## Development

Run all quality gates before pushing:

```bash
pnpm check    # typecheck + lint + test
pnpm build    # verify clean build
```

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
pnpm changeset
```

## Pull requests

- Fill out the PR template
- Ensure `pnpm check` passes
- Keep PRs focused — one concern per PR

## Release process

Releases are fully automated. No manual npm login or tokens required.

1. PRs with changesets get merged to `main`
2. The [Release workflow](.github/workflows/release.yml) creates a "Version Packages" PR that bumps versions and updates the changelog
3. Merging the "Version Packages" PR publishes to npm and creates a GitHub release
4. npm authentication uses [OIDC Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) — no `NPM_TOKEN` secret needed

Only maintainers listed in [CODEOWNERS](.github/CODEOWNERS) can merge to `main`.
