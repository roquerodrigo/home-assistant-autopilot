# Changelog

## [1.0.2](https://github.com/roquerodrigo/home-assistant-autopilot/compare/v1.0.1...v1.0.2) (2026-11-03)

This release fixes a publishing problem that made earlier releases unusable for every workflow that uses the action.

### Bug fixes

- Fixed releases 1.0.0 and 1.0.1 being published without the bundle the action runs, which made every workflow using it fail with a file-not-found error. ([#6](https://github.com/roquerodrigo/home-assistant-autopilot/pull/6))

## [1.0.1](https://github.com/roquerodrigo/home-assistant-autopilot/compare/v1.0.0...v1.0.1) (2026-11-03)

### Bug fixes

- The action could not be listed on the GitHub Marketplace because its description was too long; it is now shorter and can be listed and found there. ([#4](https://github.com/roquerodrigo/home-assistant-autopilot/pull/4))

## 1.0.0 (2026-11-03)

First release of Home Assistant Autopilot, validating Marketplace repositories and attaching their release assets.

### New features

- Validates Home Assistant Marketplace repositories for layout, hacs.json, declared versions, download size, hassfest and catalog rules, with nothing to configure. ([#1](https://github.com/roquerodrigo/home-assistant-autopilot/pull/1))
- Attaches the zip of an integration or the module of a dashboard card to a published release, refusing a tag that disagrees with the declared version. ([#1](https://github.com/roquerodrigo/home-assistant-autopilot/pull/1))
