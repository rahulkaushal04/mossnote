#!/usr/bin/env bash
# The Linux download in a bare container (no Node.js, no curl): container-smoke.sh <tarball> <version> [--expect-unsupported]
set -u

tarball=${1:?usage: container-smoke.sh <tarball> <version> [--expect-unsupported]}
version=${2:?usage: container-smoke.sh <tarball> <version> [--expect-unsupported]}
mode=${3:-}

passed=0
ok() { passed=$((passed + 1)); }
fail() { echo "FAILED: $*" >&2; exit 1; }
check() { local message=$1; shift; if "$@"; then ok; else fail "$message"; fi; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

system=$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-$(uname -s)}")
libc=$( { getconf GNU_LIBC_VERSION || ldd --version | head -1; } 2>/dev/null | head -1)
echo "== $system, $(uname -m), ${libc:-no glibc}"

work=$(mktemp -d)
trap 'kill -KILL ${pid:-} 2>/dev/null; rm -rf "$work"' EXIT
export HOME="$work/home"
mkdir -p "$HOME"
unset XDG_DATA_HOME XDG_CACHE_HOME XDG_CONFIG_HOME MOSS_DATA_DIR MOSS_PORT MOSS_JOURNAL NODE_ENV

if [ "$(uname -s)" = Darwin ]; then
  data="$HOME/Library/Application Support/Mossnote"
  cache="$HOME/Library/Caches/Mossnote/app"
else
  data="$HOME/.local/share/mossnote"
  cache="$HOME/.cache/Mossnote/app"
fi

echo "== The download"
( cd "$(dirname "$tarball")" && sha256 -c "$(basename "$tarball").sha256" >/dev/null ) \
  && ok || fail "the checksum does not match $tarball.sha256"
tar -xzf "$tarball" -C "$work" || fail "the tarball cannot be unpacked"
program="$work/mossnote"
bare() { env PATH=/nonexistent "$program" "$@"; }
check "the tarball holds an executable called mossnote" test -x "$program"
check "the tarball holds only that file" test "$(tar -tzf "$tarball")" = mossnote

if [ "$mode" = --expect-unsupported ]; then
  echo "== Expected to be unsupported: does it start?"
  if out=$(bare --version 2>&1) && [ "$out" = "$version" ]; then
    echo "It runs here, although this system is below the documented minimum."
  else
    echo "It does not run here, as documented: $(echo "$out" | head -2 | tr '\n' ' ')"
  fi
  exit 0
fi

echo "== Version, help and mistakes (the program is run with an empty PATH: no Node.js, nothing)"
check "--version prints $version" test "$(bare --version 2>&1)" = "$version"
bare --help 2>&1 | grep -q "includes its own Node.js" && ok || fail "--help describes the program"
bare --prot 1 >/dev/null 2>"$work/err"; rc=$?
check "an unknown option exits 1 and says why" test "$rc" = 1 -a -n "$(grep 'Unknown option' "$work/err")"
check "--version unpacked nothing" test ! -e "$cache"

port=$((20000 + RANDOM % 20000))
http() { # method path [json body]: the whole response, headers and body
  local method=$1 path=$2 body=${3:-}
  exec 3<>"/dev/tcp/127.0.0.1/$port" || return 1
  if [ -n "$body" ]; then
    printf '%s %s HTTP/1.1\r\nHost: 127.0.0.1:%s\r\nConnection: close\r\nContent-Type: application/json\r\nX-Moss-Client: web\r\nContent-Length: %s\r\n\r\n%s' \
      "$method" "$path" "$port" "${#body}" "$body" >&3
  else
    printf '%s %s HTTP/1.1\r\nHost: 127.0.0.1:%s\r\nConnection: close\r\n\r\n' "$method" "$path" "$port" >&3
  fi
  cat <&3
  exec 3<&-
}
status() { head -1 | cut -d' ' -f2; }
wait_for_health() {
  for _ in $(seq 1 240); do
    if http GET /api/health 2>/dev/null | head -1 | grep -q ' 200'; then return 0; fi
    kill -0 "$pid" 2>/dev/null || return 1
    sleep 0.5
  done
  return 1
}
launch() { env PATH=/nonexistent "$program" --no-open --port "$port" >"$work/log" 2>&1 & pid=$!; wait_for_health || { cat "$work/log" >&2; fail "it did not come up"; }; }

echo "== First start: unpacks, serves, makes a journal"
launch
grep -q "unpacking for the first run" "$work/log" && ok || fail "the first start says it is unpacking"
ready=$(ls "$cache"/*/.ready 2>/dev/null | wc -l | tr -d ' ')
check "one finished copy of the app is in the cache" test "$ready" = 1
check "the app page is served" test "$(http GET / | grep -c 'id="root"')" -ge 1
check "the API reports $version" test -n "$(http GET /api/health | grep "\"version\":\"$version\"")"
check "a journal can be made" test "$(http POST /api/journals '{"name":"Smoke","template":"default"}' | status)" = 201
check "a note can be written" test "$(http POST /api/notes '{"body":"A lantern by the gate #lead"}' | status)" -lt 300
check "the journal is a file in the data folder" test -f "$data/smoke.db"
check "nothing was written next to the program" test "$(ls -A "$work" | sort | tr '\n' ' ')" = "err home log mossnote "

echo "== Stop it (as a service manager does), start it again"
kill -TERM "$pid"; wait "$pid"; rc=$?
check "SIGTERM ends with exit code 0 (got $rc)" test "$rc" = 0
check "the lock file is removed" test ! -e "$data/smoke.lock"
check "the write-ahead log is folded back in" test ! -e "$data/smoke.db-wal"
launch
check "the second start does not unpack again" test -z "$(grep unpacking "$work/log")"
check "the note is still there" test -n "$(http GET /api/data/export.json | grep 'A lantern by the gate')"
kill -KILL "$pid"; wait "$pid" 2>/dev/null
launch
check "after a hard kill it starts and keeps the note" test -n "$(http GET /api/data/export.json | grep 'A lantern by the gate')"
kill -INT "$pid"; wait "$pid"; rc=$?
check "Ctrl+C ends with exit code 0 (got $rc)" test "$rc" = 0

echo "== Clean up"
check "the cache holds just the one copy" test "$(ls "$cache" | wc -l | tr -d ' ')" = 1
check "no half-finished unpack is left" test -z "$(ls "$cache" | grep unpacking)"
rm -rf "$cache"
check "deleting the cache leaves the journal alone" test -f "$data/smoke.db"
launch
check "it unpacks again after the cache is deleted, and finds the journal" test -n "$(http GET /api/data/export.json | grep 'A lantern by the gate')"
kill -TERM "$pid"; wait "$pid"

echo
echo "Container check passed: $passed checks on $system, $(uname -m)."
