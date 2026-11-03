# home-assistant-autopilot

GitHub Action, command line and npm package that validates Home Assistant Marketplace
repositories and attaches their release asset. `README.md` is the public contract:
inputs, outputs, checks and assets. Consumers track `@v1` or `@latest`, which
`self-release.yml` moves on every release, so a release is live everywhere on its next
run: treat those names, and the check name `Home Assistant` of `validate.yml`, as a
public contract, and break them only with a new major version.

## Architecture

- `src/domain`: pure rules. `hacs.json`, the integration manifest, project detection,
  the checks, versions, release assets and the report. No I/O.
- `src/application`: the two use cases, `ValidateProject` and `PublishReleaseAsset`,
  behind the ports in `ports.ts`.
- `src/infrastructure`: the adapters. Git checkout, GitHub API, zip, Docker and the two
  external validators.
- `src/home-assistant-autopilot.ts`: wires everything behind `HomeAssistantAutopilot`,
  the public API of the npm package (`src/index.ts`).
- `src/action.ts` reads the inputs of the action and `src/cli.ts` the arguments of the
  command line, and both call `HomeAssistantAutopilot`. `src/main.ts` and `src/bin.ts`
  only run them.

## The validators stay hidden

The catalog checks run the image of the HACS action. `src/infrastructure/catalog-validator.ts`
is the only file that knows it: its image, its environment variables, its category
names (`plugin` for a dashboard) and its log format. Nothing public is named after it:
no input, output, check name or summary text. The Marketplace is the product the
consumer knows.

Both images are pinned by tag and digest in `images/*.Dockerfile`, which esbuild embeds
as text. Dependabot follows hassfest's versioned tags. The catalog image only publishes
`main`, so `self-images.yml` follows its digest. Both are `linux/amd64` only: they cannot
run on an arm64 machine, so the end-to-end job in CI is their only real test.

## Verifying a change

- `npx eslint`, `npm test` (type check, tests and coverage). The tests run the real
  adapters against `tests/fake-github.ts`, real Git checkouts in a temporary directory
  and a scripted Docker; coverage only counts files the tests load.
- `End to end` in CI runs the action, built from the commit, on
  `ha-integration-blueprint` and `ha-battery-card`.
- Never commit `dist/`. The action runs the bundle at its tag, and only the release pull
  request carries it: `self-bundle.yml` builds it there, and CI fails a release pull
  request whose bundle is stale.
- `npm run build:package` builds the npm package into `lib/`. `self-release.yml`
  publishes it at each release through trusted publishing.
- `eslint --fix` sorts object keys: never rely on the order of a literal's keys.
- Workflows: `actionlint` and `uvx --from 'zizmor>=1,<2' zizmor --persona regular --min-severity low .`

## Git

Public repo with branch protection: work on a feature branch, open a PR, let CI go
green. Merge with **rebase merge only** (squash and merge-commit are disabled).
