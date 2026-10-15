#!/usr/bin/env bash
# Check that a Wonop package still fits the runtime API it will be loaded by
# (WON-318).
#
# A package that lives in its own repository has nothing in-tree that fails when
# the runtime moves on. This is that something, runnable on any package
# directory, in this repository or outside it:
#
#   tools/ci/check-package-api.sh path/to/package [more/packages...]
#   WONOP_RUNTIME_DIR=/path/to/wonop-runtime tools/ci/check-package-api.sh .
#
# Two checks per package:
#
#   1. The manifest. The fields `AppManifest::load` refuses a package without
#      (`id`, `icon`, `description`, a semver `version`) are present, `entry`
#      and `icon` exist inside the package, and `apiVersion` (absent means 1)
#      is one the runtime serves: between `oldest` and `current` in
#      `wonop-runtime/api-version.json`. A test in `wonop-apps` keeps that file
#      equal to the host's own constants.
#   2. The entry. `main.ts` is type-checked by Deno against the runtime's
#      `wm.d.ts` and `app.d.ts`. `wm.d.ts` is generated with `export` on some
#      declarations, which would make it a module and hide its `wm` global, so
#      the check reads a copy with those keywords removed. The package's entry
#      runs as a classic script, where every declaration is global, and the
#      copy declares it the same way.
#
# WONOP_RUNTIME_DIR names the runtime to check against. It defaults to this
# repository's `wonop-runtime/`; a standalone package points it at a Wonop
# checkout or at a vendored copy of the three files.
#
# Deno, as `check-package-js.sh` uses for the entry tests: the isolate runs
# TypeScript and so does Deno, with no build step. Missing Deno is a skip, or a
# failure with WONOP_REQUIRE_JS_CHECKS=1, the same switch that script reads.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && cd .. && pwd)"
runtime="${WONOP_RUNTIME_DIR:-${root}/wonop-runtime}"
require="${WONOP_REQUIRE_JS_CHECKS:-0}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <package-dir> [<package-dir>...]" >&2
  exit 2
fi

if ! command -v deno >/dev/null 2>&1; then
  if [ "${require}" = "1" ]; then
    echo "package API check: deno is not installed" >&2
    exit 1
  fi
  echo "package API check skipped: deno is not installed"
  exit 0
fi

for file in api-version.json wm.d.ts app.d.ts; do
  if [ ! -f "${runtime}/${file}" ]; then
    echo "package API check: ${runtime}/${file} is missing; set WONOP_RUNTIME_DIR" >&2
    exit 2
  fi
done

work="$(mktemp -d "${TMPDIR:-/tmp}/wonop-package-api.XXXXXX")"
trap 'rm -rf "${work}"' EXIT
sed 's/^export //' "${runtime}/wm.d.ts" >"${work}/wm.d.ts"
cp "${runtime}/app.d.ts" "${work}/app.d.ts"
printf '{ "compilerOptions": { "types": ["./wm.d.ts", "./app.d.ts"] } }\n' >"${work}/deno.json"

# The manifest half, as a Deno script so it reads JSON the way the runtime does.
cat >"${work}/manifest-check.ts" <<'TS'
const [dir, versionsPath] = Deno.args;
const versions = JSON.parse(Deno.readTextFileSync(versionsPath));
const problems: string[] = [];
let m: Record<string, unknown> = {};
try {
  m = JSON.parse(Deno.readTextFileSync(`${dir}/manifest.json`));
} catch (e) {
  console.log(`manifest.json: ${(e as Error).message}`);
  Deno.exit(1);
}
const text = (k: string) => typeof m[k] === "string" && (m[k] as string).trim() !== "";
const inside = (p: string) => !p.startsWith("/") && !p.includes("..");
const exists = (p: string) => {
  try {
    return Deno.statSync(`${dir}/${p}`).isFile;
  } catch {
    return false;
  }
};
if (!text("id")) problems.push("no \"id\"");
if (!text("description")) problems.push("no \"description\": the catalogue shows it under the name");
if (!text("version")) {
  problems.push("no \"version\": add a semver version, e.g. \"0.1.0\"");
  // The same rule as the host's `parse_semver` (crates/wm-types/src/manifest.rs):
  // three integers, a `-` or `+` suffix tolerated. Change both together.
} else if (!/^\d+\.\d+\.\d+([-+].*)?$/.test((m.version as string).trim())) {
  problems.push(`version ${JSON.stringify(m.version)} is not semver (MAJOR.MINOR.PATCH)`);
}
if (!text("icon")) {
  problems.push("no \"icon\": the catalogue needs one");
} else if (!inside(m.icon as string) || !exists(m.icon as string)) {
  problems.push(`icon ${JSON.stringify(m.icon)} is not a file inside the package`);
}
const entry = typeof m.entry === "string" ? m.entry : "main.ts";
if (!inside(entry) || !exists(entry)) problems.push(`entry ${JSON.stringify(entry)} is not a file inside the package`);
const api = m.apiVersion === undefined ? 1 : m.apiVersion;
if (typeof api !== "number" || !Number.isInteger(api)) {
  problems.push(`apiVersion ${JSON.stringify(api)} is not an integer`);
} else if (api > versions.current) {
  problems.push(`apiVersion ${api} is newer than this runtime serves (v${versions.current}): it would be refused with "update Wonop"`);
} else if (api < versions.oldest) {
  problems.push(`apiVersion ${api} is older than this runtime still loads (v${versions.oldest})`);
}
for (const p of problems) console.log(`manifest: ${p}`);
console.log(`entry=${entry}`);
Deno.exit(problems.length ? 1 : 0);
TS

status=0
for dir in "$@"; do
  dir="$(cd "${dir}" && pwd)"
  printf '\n== %s\n' "${dir#"${root}/"}"
  if ! out="$(deno run --no-lock --quiet --allow-read "${work}/manifest-check.ts" "${dir}" "${runtime}/api-version.json")"; then
    printf '%s\n' "${out}" | grep -v '^entry=' >&2 || true
    status=1
    continue
  fi
  entry="$(printf '%s\n' "${out}" | sed -n 's/^entry=//p')"
  echo "manifest: ok (apiVersion within $(deno eval --quiet "const v=JSON.parse(Deno.readTextFileSync('${runtime}/api-version.json'));console.log('v'+v.oldest+'..v'+v.current)"))"
  if (cd "${work}" && deno check --config deno.json --no-lock --quiet "${dir}/${entry}"); then
    echo "types: ${entry} ok against wm.d.ts and app.d.ts"
  else
    echo "types: ${entry} does not type-check against the runtime" >&2
    status=1
  fi
done

exit "${status}"
