#!/bin/sh
# Prepares the demoparser dependency for a build. Run it once before the first `cargo build` on a machine, and again
# after changing the pinned commit of demoparser in Cargo.toml. The Dockerfile runs it too.
#
# Why it is needed: the build script of demoparser's protobuf crate (csgoproto) compiles Valve's protobuf definitions
# every time it is built, and to get them it clones the HEAD of SteamDatabase/GameTracking-CS2 into its own source
# directory. That makes a build depend on whatever Valve shipped last, and those definitions do not always compile
# (they did not on 2026-10-09). The clone is skipped when the directory exists, so this script puts the definitions
# there first, at one fixed commit, and fetches only the files the build reads.
set -eu

GAMETRACKING_URL=https://github.com/SteamDatabase/GameTracking-CS2.git
# The last commit before the definitions stopped compiling (CS2 build 2000924, 2026-10-04).
GAMETRACKING_REV=e8bd6b0f800bb38a918455b55a7b0921b972c259

cd "$(dirname "$0")"
cargo fetch --locked

# Where Cargo checked out the csgoproto crate, such as ~/.cargo/git/checkouts/demoparser-<hash>/<rev>/src/csgoproto.
manifest=$(cargo metadata --locked --format-version 1 \
    | grep -o '"manifest_path":"[^"]*/csgoproto/Cargo.toml"' | head -n 1 \
    | sed -e 's/^"manifest_path":"//' -e 's/"$//')
if [ -z "$manifest" ]; then
    echo "seed-protos: cannot find the csgoproto crate among the dependencies" >&2
    exit 1
fi
target="$(dirname "$manifest")/GameTracking-CS2"

if [ "$(git -C "$target" rev-parse HEAD 2>/dev/null || true)" = "$GAMETRACKING_REV" ]; then
    echo "seed-protos: $target is at $GAMETRACKING_REV already"
    exit 0
fi

rm -rf "$target"
git init --quiet "$target"
git -C "$target" remote add origin "$GAMETRACKING_URL"
git -C "$target" sparse-checkout set --no-cone \
    '/Protobufs/*.proto' \
    '/game/csgo/pak01_dir/scripts/items/items_game.txt' \
    '/game/csgo/pak01_dir/resource/csgo_english.txt'
git -C "$target" fetch --quiet --depth=1 --filter=blob:none origin "$GAMETRACKING_REV"
git -C "$target" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
echo "seed-protos: $target is now at $GAMETRACKING_REV"
