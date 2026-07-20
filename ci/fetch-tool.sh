#!/usr/bin/env bash
# fetch-tool.sh <repo-name> <sha> <dest> — shallow-clone a sibling tool AT AN EXACT COMMIT.
#
# `git clone --depth 1 <url>` only ever gets the tip of the default branch, so it cannot check out a pinned
# SHA — that is why this isn't a one-liner. Fetching the SHA directly is the shallow equivalent (GitHub
# serves arbitrary commits), and it stays O(1) in history size.
#
# Fails loudly if the SHA is gone: history rewrites happen (they have here), and a pin that silently fell
# back to main would defeat the entire point of pinning.
set -euo pipefail

name="$1"; sha="$2"; dest="$3"
url="https://github.com/aaronhg/${name}.git"

rm -rf "$dest"
mkdir -p "$dest"
git -C "$dest" init -q
git -C "$dest" remote add origin "$url"

if ! git -C "$dest" fetch -q --depth 1 origin "$sha" 2>/dev/null; then
  echo "::error::${name}: pinned commit ${sha} not found on ${url}."
  echo "  It was probably never pushed, or the history was rewritten. Update ci/pins.env to a commit that exists."
  exit 1
fi

git -C "$dest" checkout -q FETCH_HEAD
echo "${name} @ $(git -C "$dest" rev-parse --short HEAD)  ($(git -C "$dest" log -1 --format=%s | cut -c1-60))"
