# Working on this Wonop package

This folder is a Wonop package: a small app that runs inside the Wonop desktop
workbench. You never need the Wonop source code to build it. Everything the
package can use is declared in `runtime/`, and the guides are listed below.

## What is here

| File | What it is |
|---|---|
| `manifest.json` | id, name, version, icon, commands, permissions, window size |
| `main.ts` | the logic: one classic script (no `import`/`export`) that calls `app.define({ commands, onOpen, onInput, onMessage })` |
| `main.test.ts` | the entry test: `app` is stubbed, the real `main.ts` is imported, commands are called directly |
| `ui/index.html` | the window; `wm.send`, `wm.call` and `wm.onMessage` talk to `main.ts` |
| `icon.svg` | required; draw in `currentColor` so it reads in both themes |
| `runtime/app.d.ts` | the `app` global `main.ts` can use (`app.fetch`, `app.ai`, `app.store`, `app.secrets`, …) |
| `runtime/wm.d.ts` | the `wm` API a person or agent can call |
| `runtime/api-version.json` | the API versions this kit was written for |
| `scripts/check-package-api.sh` | checks the manifest and type-checks `main.ts` against `runtime/` |

`runtime/`, `scripts/check-package-api.sh`, `deno.json`, `AGENTS.md`,
`CLAUDE.md` and `.gitignore` are the kit. `wm.dev.kit("<this folder>")`
refreshes them and never touches your own files, so do not edit them by hand.

## If you are a coding agent in Wonop

You are connected to Wonop's MCP server (`wonop`). Use its tools for the whole
loop instead of looking for the Wonop source or guessing:

| Tool | Does |
|---|---|
| `package_docs` | the docs below; no topic lists them, `offset` pages |
| `package_reload` | reload now; answers each stage (validate, transpile, start, announce) with its time |
| `package_errors`, `package_logs` | what broke, with file and line; what the package logged |
| `package_inspect` | loaded and source version, last reload, windows, stripped permissions |
| `package_test` | `main.test.ts` and the API check, from this folder |
| `package_request_approval` | ask the person to approve the permissions the manifest declares |
| `package_create`, `package_link`, `package_kit` | a new package, run a folder, refresh the kit; the person approves each on a card |

The same docs and kit files are MCP resources: `wonop://docs/<topic>` (start
with `wonop://docs/build-a-package`) and `wonop://kit/<file>`, for example
`wonop://kit/runtime/app.d.ts`.

These tools work only on packages whose folder is inside your workspace or a
folder the person approved for you; anything else is refused. Every tool takes
the package `id` from `manifest.json`, or its absolute folder path.

## Where the docs are

Ask Wonop. The same topics are served in the § console, and to coding agents
through `package_docs` and the `wonop://docs/<topic>` resources:

- `await wm.dev.docs()` lists the topics.
- `await wm.dev.docs("build-a-package")` is the short guide: manifest,
  permissions, UI, `app.ai`, `app.store`, tests, the loop and approvals.
- `package-development` is the full guide, `style-guide` how a package must
  look, `app-api` and `wm-api` the declarations, `example-hn-search` and
  `example-markdown` two worked packages.
- A long topic comes in pages: pass the answer's `next` back as
  `wm.dev.docs(topic, { offset: next })`.

## The loop

The package is linked: Wonop runs it from this folder.

1. Edit and save. Wonop reloads the package within about a second and keeps
   its windows open.
2. Check: `await wm.dev.inspect("<id>")` (`package_inspect` or
   `package_reload`) shows the last reload's stages, and
   `await wm.dev.errors("<id>")` (`package_errors`) shows what broke and where.
   A failed reload keeps the previous version running, so fix it and save
   again.
3. Test: `await wm.dev.test("<id>")` (`package_test`), or `deno task ci` in
   this folder (`deno task test` runs `main.test.ts`, `deno task check` the API
   check).
4. Try it: `await wm.apps["<id>"].<command>({ … })`.

`<id>` is the `id` in `manifest.json`.

## Permissions and approval

A package may only do what `manifest.json` declares and the person approved.
Network hosts go in `permissions.http`, keys in `permissions.secrets`, AI tasks
in `permissions.ai`. A linked package runs without anything nobody approved,
and `wm.dev.inspect` lists what is stripped. When you add a permission, call
`await wm.dev.requestApproval("<id>")` (`package_request_approval`) and say
what it is for. Only the person
answers that card. Never ask for more than the package needs.

## Rules

- Follow the style guide (`wm.dev.docs("style-guide")`): content to the edges,
  one primary action, colour only for meaning, light and dark themes.
- Keep every secret out of logs, results and the page.
- Commit in small steps with clear messages. Never push, publish or add a
  remote unless the person asks: publishing is their action.
- When you are done, report back to Roxy in plain words: what works, what you
  tested, and anything the person has to approve or decide.
