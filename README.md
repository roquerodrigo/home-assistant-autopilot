# Home Assistant Autopilot

[![Marketplace](https://img.shields.io/badge/Marketplace-Home%20Assistant%20Autopilot-2088ff?logo=githubactions&logoColor=white&style=for-the-badge)](https://github.com/marketplace/actions/home-assistant-autopilot)
[![Release](https://img.shields.io/github/v/release/roquerodrigo/home-assistant-autopilot?style=for-the-badge)](https://github.com/roquerodrigo/home-assistant-autopilot/releases/latest)
[![npm](https://img.shields.io/npm/v/home-assistant-autopilot?logo=npm&style=for-the-badge)](https://www.npmjs.com/package/home-assistant-autopilot)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white&style=for-the-badge)](https://github.com/sponsors/roquerodrigo)

Validates integrations, dashboard cards, themes and templates for the
[Home Assistant Marketplace](https://contributors.home-assistant.io/marketplace/), and
attaches what the Marketplace installs to each release.

It reads what the repository is from the repository itself: `hacs.json`, the
integration under `custom_components/`, the dashboard module, the theme or the
template. Nothing needs to be configured.

## Usage

The action is listed on the
[GitHub Marketplace](https://github.com/marketplace/actions/home-assistant-autopilot).

### Validate

Add a job to CI that checks out the repository and runs the action:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions: {}

jobs:
  validate:
    name: Home Assistant Marketplace
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: roquerodrigo/home-assistant-autopilot@v2
```

The job summary lists every check, and each problem is annotated on the file it
belongs to.

### Publish

After the release is published, attach its asset. With
[Release Autopilot](https://github.com/marketplace/actions/release-autopilot) it is one
more step in the same job, with no checkout:

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - id: release
        uses: roquerodrigo/release-autopilot@v1
        with:
          token: ${{ secrets.RELEASE_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

      - if: steps.release.outputs.released == 'true'
        uses: roquerodrigo/home-assistant-autopilot@v2
        with:
          command: publish
          tag: ${{ steps.release.outputs.tag }}
```

Any release tool works the same way: pass the tag of a published release.

`@v2` follows every 2.x release, and a breaking change only arrives with a new major
version. `@latest` follows every release, breaking ones included. To stay on one
version, use the tag of a
[release](https://github.com/roquerodrigo/home-assistant-autopilot/releases), such as
`@v2.0.0`, or its commit.

| Input        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `command`    | `validate`, the default, or `publish`                                      |
| `tag`        | For `publish`, the tag of the published release                            |
| `token`      | Defaults to `GITHUB_TOKEN`. `publish` needs contents write access          |
| `repository` | Defaults to the repository of the workflow                                 |

| Output      | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| `category`  | `integration`, `dashboard`, `theme` or `template`                |
| `domain`    | The domain of the integration, if it is one                      |
| `asset`     | The name of the asset `publish` attached, if any                 |
| `asset-url` | Its download URL, if any                                         |

## What it checks

| Check         | What fails it                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Layout        | No `hacs.json`, more than one integration or theme, a module or template `hacs.json` names that is missing, a domain in the wrong format or out of its directory, a manifest without a version |
| `hacs.json`   | No `name`, `zip_release` on anything but an integration, or without a `filename` ending in `.zip`       |
| Versions      | `manifest.json`, `pyproject.toml` and `package.json` declaring different versions                        |
| Download size | Over 100 MiB or 50,000 files, or a template over 5 MiB                                                    |
| Hassfest      | Anything the Home Assistant manifest validator reports, for an integration                               |
| Catalog       | Anything the catalog checks of the Marketplace report: brands, topics, description, archived and the rest |

Keys of `hacs.json` the Marketplace no longer reads, such as `hacs`, are reported as
warnings. A private repository cannot enter the Marketplace, so the catalog checks are
skipped there, and the summary says so.

Hassfest and the catalog checks run in Docker images pinned by digest, which this
repository keeps up to date. They are `linux/amd64` images, so the job needs a Linux
runner such as `ubuntu-latest`.

The checks themselves are described in the
[Marketplace reference](https://contributors.home-assistant.io/marketplace/reference/validation/).

## What it publishes

The Marketplace installs a published release, and for an integration it refuses one
whose manifest declares another version. `publish` therefore fails when a version
declared at the tag differs from the tag, before anything is attached.

| Repository  | Asset                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- |
| Integration | With `zip_release` in `hacs.json`, a zip named after `filename` holding `custom_components/<domain>/` at its root |
| Dashboard   | The module, as it is at the tag                                                          |
| Theme, template | Nothing: the Marketplace installs them from the repository                           |

The zip holds the files tracked at the tag, read through the GitHub API, in a fixed
order and with fixed timestamps, so the same tag always gives the same bytes. An asset
of the same name is replaced, so a run can be repeated.

The release's `download_count` becomes the install counter: without the asset, the
Marketplace downloads through the API and the download is counted nowhere.

```json
{ "name": "My integration", "zip_release": true, "filename": "my_integration.zip" }
```

## Outside GitHub Actions

The same checks run from any terminal with the
[npm package](https://www.npmjs.com/package/home-assistant-autopilot), on Node 24 or
later, with Docker for hassfest and the catalog checks:

```sh
GITHUB_TOKEN=... npx home-assistant-autopilot validate --repository owner/name
GITHUB_TOKEN=... npx home-assistant-autopilot publish --repository owner/name --tag v1.2.0
```

`validate` prints the report and exits with 1 when a check fails. The catalog checks
read the repository on GitHub at `--ref`, the commit checked out by default, so push it
first. `publish` prints the outcome as JSON:

```json
{"asset":"my_integration.zip","assetUrl":"https://github.com/owner/name/releases/download/v1.2.0/my_integration.zip","category":"integration","domain":"my_integration"}
```

| Option                      | Meaning                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `--repository <owner/name>` | The repository on GitHub. Defaults to `GITHUB_REPOSITORY`         |
| `--directory <path>`        | `validate`: the checkout. Defaults to the current directory       |
| `--ref <commit>`            | `validate`: the commit the catalog checks read                    |
| `--tag <tag>`               | `publish`: the tag of the release                                 |

The token comes from `GITHUB_TOKEN`, or `GH_TOKEN`. The package also exports both
commands as a library:

```ts
import { HomeAssistantAutopilot } from 'home-assistant-autopilot'

const autopilot = new HomeAssistantAutopilot({ repository: 'owner/name', token: process.env.GITHUB_TOKEN! })
const { report } = await autopilot.validate()
const { asset } = await autopilot.publish('v1.2.0')
```

A `reporter` with `group`, `info` and `warning` receives the progress, which otherwise
goes to the console.

## Support

This project is built and maintained on personal time. If it is useful to you, consider [sponsoring the work](https://github.com/sponsors/roquerodrigo) — it keeps the development, the testing and the releases coming.
