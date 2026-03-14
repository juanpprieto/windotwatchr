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
