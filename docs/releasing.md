# Releasing Qme

This repo is shaped to publish one user-facing package, `qme`, plus internal
support packages under `@qme/*`. Publish the internal packages first, then the
public package.

Important: as of August 31, 2026, `qme` already exists on npm as an unrelated
package at version `1.0.5`. A real public release needs one of these decisions
first:

- Get publish ownership for `qme`.
- Rename the public package, for example to `@santistebanc/qme`.
- Publish an initial version higher than the existing npm package only if you
  actually own the package name.

## Before Publishing

1. Update versions in every publishable package:
   - `packages/client/package.json`
   - `packages/core/package.json`
   - `packages/sdk/package.json`
   - `packages/server/package.json`
   - `packages/qme/package.json`
2. Update internal dependency versions so they match the release version.
3. Move the `CHANGELOG.md` entry from `Unreleased` to the release date.
4. Run `npm run verify`.
5. Commit and push the release prep changes.

## Manual Publish

Use the `Publish npm Packages` workflow from GitHub Actions.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish access for `qme` and `@qme/*`.

The workflow runs `npm run verify`, checks that package versions are aligned,
then publishes in this order:

1. `@qme/client`
2. `@qme/core`
3. `@qme/sdk`
4. `@qme/server`
5. `qme`

Keep `dry_run` enabled for the first run of a release. Disable it only after the
dry run passes and the package-name ownership question above is resolved.

Use the `next` dist-tag for pre-1.0 release candidates. Use `latest` only when
you are ready for the default npm install path.
