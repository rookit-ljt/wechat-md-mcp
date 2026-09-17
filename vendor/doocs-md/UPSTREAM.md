# Vendored: doocs/md renderer core

This directory holds a trimmed copy of doocs/md's renderer so this repo is
self-contained — you do not need doocs/md checked out anywhere else.

## What was vendored

| Upstream path | Local path | Why |
| --- | --- | --- |
| `packages/core/src/**` | `vendor/doocs-md/core/src/` | The renderer: Markdown in, styled HTML out |
| `packages/shared/src/**` | `vendor/doocs-md/shared/src/` | Types and the three theme CSS files core reads |

`*.test.ts` / `*.spec.ts` files were dropped — they depend on vitest, which this
project does not pull in.

`packages/shared/src/editor/**` was also dropped. Those are CodeMirror bindings
for the browser UI; nothing reaches them from the render path, and they are
only reachable at all through `@md/shared`'s bare index export, which neither
core nor this project imports.

Upstream has no other `@md/*` interdependency inside these two packages, which
is why nothing else had to come along.

Note this means importing the bare specifier `@md/shared` **will fail** — reach
for the subpaths (`@md/shared/configs`, `@md/shared/types`, `@md/shared/utils`)
the way upstream core does.

## Pinned upstream

- Repository: <https://github.com/doocs/md>
- Commit: `8770fde1d20880494d628ab8f23dc5feb7f5229c`
- Version: `2.1.0`
- Date: 2026-09-16
- License: MIT, Copyright (c) Doocs

## How this is wired in

`tsconfig.json` maps the aliases the upstream source uses internally:

```json
"@md/core":        ["vendor/doocs-md/core/src/index.ts"],
"@md/core/*":      ["vendor/doocs-md/core/src/*"],
"@md/shared":      ["vendor/doocs-md/shared/src/index.ts"],
"@md/shared/*":    ["vendor/doocs-md/shared/src/*"]
```

Both the type checker and tsx honour these, so the vendored files import each
other exactly as they do upstream, unchanged.

The theme CSS lives at
`vendor/doocs-md/shared/src/configs/theme-css/` and is read at runtime from
`src/render.ts`.

## Refreshing or diffing against upstream

```bash
git clone --depth 1 https://github.com/doocs/md.git /tmp/doocs-md
cd /tmp/doocs-md && git log -1 --format='%H'          # record this below

rm -rf vendor/doocs-md/core/src vendor/doocs-md/shared/src
cp -R /tmp/doocs-md/packages/core/src   vendor/doocs-md/core/src
cp -R /tmp/doocs-md/packages/shared/src vendor/doocs-md/shared/src
find vendor/doocs-md -name '*.test.ts' -o -name '*.spec.ts' | xargs rm -f
rm -rf vendor/doocs-md/shared/src/editor
```

Then update the pinned commit above, rerun `npm test`, and check that the three
theme names in `src/render.ts` still match the CSS files on disk.

Upstream occasionally changes shared config shape; if rendering suddenly looks
unstyled, check whether a theme CSS file was renamed first.
