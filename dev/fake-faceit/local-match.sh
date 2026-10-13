#!/bin/sh
# Stands up a local match on the fake FACEIT whose rosters carry the SteamIDs of a real demo, so that the demo is that
# match's and the analysis accepts it (see "A local match that fits a real demo" in dev/fake-faceit/README.md).
#
# Why it is needed: before a parsed demo is analyzed its players are compared with the match's roster, and a demo whose
# players are not the roster's is FAILED with the code WRONG_MATCH. The roster of the fake's main match carries made-up
# SteamIDs, which no real demo has. This script reads the players of the real demo from the database of a running fake
# stack, on which the demo has been uploaded to the main match and parsed once, and writes WireMock stubs for a second
# match whose two rosters carry those SteamIDs, with made-up nicknames and FACEIT ids, and for the files that match
# needs: its details, its statistics, the demo file and the Downloads API's answer for it.
#
# Usage, from anywhere in the repository (the stack has to be running):
#   dev/fake-faceit/local-match.sh [SOURCE_MATCH_ID]
# SOURCE_MATCH_ID is the match the real demo was uploaded to; the default is the fake's main match. Settings, all
# optional, from the environment:
#   COMPOSE         the docker compose command of the running stack, run from the repository root; the default is
#                   "docker compose -f docker-compose.yml -f docker-compose.fake.yml". Another project name or file
#                   set, such as an isolated stack's, goes in here.
#   LOCAL_MATCH_ID  the id of the match to make (a made-up one); the default is 1-eeeeeeee-1111-2222-3333-444444444444.
#
# What it writes is dev/fake-faceit/mappings/local-match.json. Its rosters hold REAL players' SteamIDs, which are personal
# data: the file is ignored by git (.gitignore), the script refuses to write it anywhere that is not, and it prints counts
# only. Never commit it and never paste it anywhere.
set -eu

cd "$(dirname "$0")/../.."

COMPOSE=${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.fake.yml}
SOURCE_MATCH_ID=${1:-1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}
LOCAL_MATCH_ID=${LOCAL_MATCH_ID:-1-eeeeeeee-1111-2222-3333-444444444444}
OUT=dev/fake-faceit/mappings/local-match.json
DEMO_FILE=dev/fake-faceit/__files/demos/local.dem

for id in "$SOURCE_MATCH_ID" "$LOCAL_MATCH_ID"; do
    case $id in
        *[!a-zA-Z0-9-]* | '')
            echo "local-match: a match id is letters, digits and '-' only: $id" >&2
            exit 1
            ;;
    esac
done

# The file holds real SteamIDs: never write it where git would pick it up.
if git rev-parse --git-dir >/dev/null 2>&1 && ! git check-ignore -q "$OUT"; then
    echo "local-match: $OUT is not ignored by git; add it to .gitignore first (it holds real SteamIDs)" >&2
    exit 1
fi

# The players of the demo parsed for the source match, at most ten: the ones who played the most rounds. A player is
# told by the SteamID of his row, or by the one in his placeholder id (steam:<SteamID>) when the SteamID has been given to
# another row since. The team is the side he started on (CT is the first team, T the second). One line per player:
# "<CT or T>|<SteamID>".
SQL="
WITH played AS (
  SELECT p.id,
         coalesce(p.steam_id, CASE WHEN p.faceit_id ~ '^steam:[0-9]{17}\$' THEN substr(p.faceit_id, 7) END) AS steam_id,
         count(*) AS rounds,
         (array_agg(rp.side ORDER BY rp.round_number))[1] AS first_side
  FROM round_players rp
  JOIN matches m ON m.id = rp.match_id
  JOIN players p ON p.id = rp.player_id
  WHERE m.faceit_match_id = '$SOURCE_MATCH_ID'
  GROUP BY p.id
), best AS (
  SELECT steam_id, first_side FROM played WHERE steam_id IS NOT NULL ORDER BY rounds DESC, steam_id LIMIT 10
)
SELECT first_side || '|' || steam_id FROM best ORDER BY first_side, steam_id"

# shellcheck disable=SC2086 # COMPOSE is a command with its arguments
players=$($COMPOSE exec -T postgres sh -c \
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$SQL") || {
    echo "local-match: could not read the database; is the stack running? (COMPOSE='$COMPOSE')" >&2
    exit 1
}

count=$(printf '%s\n' "$players" | grep -c '|' || true)
if [ "$count" -lt 6 ]; then
    echo "local-match: the demo of match $SOURCE_MATCH_ID has $count players in the database; upload the real demo to" >&2
    echo "that match first and wait until it is parsed (its status leaves STORED)" >&2
    exit 1
fi

# Entries of one team for a template below. $1: 1 or 2 (the team), $2: roster or stats. The FACEIT ids and nicknames are
# made up (0c0c0c0c-0000-4000-8000-<team><number>, localA1 ... localB5); the SteamIDs are the demo's.
entries() {
    printf '%s\n' "$players" | awk -F'|' -v team="$1" -v mode="$2" '
        BEGIN {
            split("21 18 15 12 9", kills, " ")
            split("14 13 13 12 12", deaths, " ")
            split("3 5 6 4 7", assists, " ")
            split("10 8 7 5 4", headshots, " ")
            split("92.4 78.2 70.1 61.5 55.3", adr, " ")
            split("4 3 2 2 1", mvps, " ")
            tag = (team == 1) ? "A" : "B"
        }
        ((team == 1 && $1 == "CT") || (team == 2 && $1 == "T")) {
            n++
            k = (n - 1) % 5 + 1
            id = sprintf("0c0c0c0c-0000-4000-8000-%010d%02d", team, n)
            sep = (n > 1) ? ",\n" : ""
            if (mode == "roster") {
                printf "%s                {\"player_id\": \"%s\", \"nickname\": \"local%s%d\", \"game_skill_level\": 10, \"membership\": \"free\", \"game_player_id\": \"%s\"}", sep, id, tag, n, $2
            } else {
                printf "%s                  {\"player_id\": \"%s\", \"nickname\": \"local%s%d\", \"player_stats\": {\"Kills\": \"%d\", \"Deaths\": \"%d\", \"Assists\": \"%d\", \"Headshots\": \"%d\", \"Headshots %%\": \"%d\", \"K/D Ratio\": \"%.2f\", \"K/R Ratio\": \"%.2f\", \"ADR\": \"%s\", \"MVPs\": \"%d\", \"Result\": \"%d\"}}", sep, id, tag, n, kills[k], deaths[k], assists[k], headshots[k], 100 * headshots[k] / kills[k], kills[k] / deaths[k], kills[k] / 24, adr[k], mvps[k], (team == 1) ? 1 : 0
            }
        }'
}

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<JSON
{
  "mappings": [
    {
      "name": "GET /matches/$LOCAL_MATCH_ID",
      "request": {"method": "GET", "urlPath": "/matches/$LOCAL_MATCH_ID"},
      "response": {
        "status": 200,
        "headers": {"Content-Type": "application/json"},
        "jsonBody": {
          "match_id": "$LOCAL_MATCH_ID",
          "version": 5,
          "game": "cs2",
          "region": "EU",
          "competition_name": "5v5 RANKED",
          "competition_type": "matchmaking",
          "organizer_id": "faceit",
          "teams": {
            "faction1": {
              "faction_id": "fac20000-0000-4000-8000-000000000001",
              "name": "team_A",
              "type": "",
              "roster": [
$(entries 1 roster)
              ]
            },
            "faction2": {
              "faction_id": "fac20000-0000-4000-8000-000000000002",
              "name": "team_B",
              "type": "",
              "roster": [
$(entries 2 roster)
              ]
            }
          },
          "voting": {
            "voted_entity_types": ["map"],
            "map": {
              "entities": [{"guid": "de_mirage", "name": "Mirage"}, {"guid": "de_inferno", "name": "Inferno"}],
              "pick": ["de_mirage"]
            }
          },
          "calculate_elo": true,
          "configured_at": 1700099900,
          "started_at": 1700100000,
          "best_of": 1,
          "status": "FINISHED",
          "faceit_url": "https://www.faceit.com/{lang}/cs2/room/$LOCAL_MATCH_ID",
          "finished_at": 1700102400,
          "results": {"winner": "faction1", "score": {"faction1": 13, "faction2": 11}},
          "demo_url": ["http://fake-faceit:8080/demos/local.dem"]
        }
      }
    },
    {
      "name": "GET /matches/$LOCAL_MATCH_ID/stats",
      "request": {"method": "GET", "urlPath": "/matches/$LOCAL_MATCH_ID/stats"},
      "response": {
        "status": 200,
        "headers": {"Content-Type": "application/json"},
        "jsonBody": {
          "rounds": [
            {
              "best_of": "1",
              "game_id": "cs2",
              "game_mode": "5v5",
              "match_id": "$LOCAL_MATCH_ID",
              "match_round": "1",
              "played": "1",
              "round_stats": {
                "Map": "de_mirage",
                "Region": "EU",
                "Rounds": "24",
                "Score": "13 / 11",
                "Winner": "fac20000-0000-4000-8000-000000000001"
              },
              "teams": [
                {
                  "team_id": "fac20000-0000-4000-8000-000000000001",
                  "premade": false,
                  "team_stats": {"Team": "team_A", "Team Win": "1", "Final Score": "13", "First Half Score": "7", "Second Half Score": "6"},
                  "players": [
$(entries 1 stats)
                  ]
                },
                {
                  "team_id": "fac20000-0000-4000-8000-000000000002",
                  "premade": false,
                  "team_stats": {"Team": "team_B", "Team Win": "0", "Final Score": "11", "First Half Score": "5", "Second Half Score": "6"},
                  "players": [
$(entries 2 stats)
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "GET /demos/local.dem",
      "request": {"method": "GET", "urlPath": "/demos/local.dem"},
      "response": {
        "status": 200,
        "headers": {"Content-Type": "application/octet-stream"},
        "bodyFileName": "demos/local.dem"
      }
    },
    {
      "name": "POST /download/v2/demos/download for the local demo",
      "priority": 1,
      "request": {
        "method": "POST",
        "urlPath": "/download/v2/demos/download",
        "headers": {"Authorization": {"equalTo": "Bearer fake-downloads-token"}},
        "bodyPatterns": [
          {"matchesJsonPath": {"expression": "\$.resource_url", "equalTo": "http://fake-faceit:8080/demos/local.dem"}}
        ]
      },
      "response": {
        "status": 200,
        "headers": {"Content-Type": "application/json"},
        "jsonBody": {"payload": {"download_url": "http://fake-faceit:8080/demos/local.dem?signature=made-up-signature"}}
      }
    }
  ]
}
JSON

if command -v jq >/dev/null 2>&1 && ! jq empty "$OUT" 2>/dev/null; then
    echo "local-match: $OUT is not valid JSON; the roster may be malformed" >&2
    exit 1
fi

# WireMock reads its stubs at start and again on a reset, which also drops stubs added through its API.
# shellcheck disable=SC2086
$COMPOSE exec -T fake-faceit curl -fsS -X POST http://localhost:8080/__admin/mappings/reset >/dev/null
# shellcheck disable=SC2086
status=$($COMPOSE exec -T fake-faceit curl -sS -o /dev/null -w '%{http_code}' "http://localhost:8080/matches/$LOCAL_MATCH_ID")
if [ "$status" != "200" ]; then
    echo "local-match: the fake answers $status for match $LOCAL_MATCH_ID after the reload" >&2
    exit 1
fi

echo "local-match: match $LOCAL_MATCH_ID is up on the fake with $count roster players (SteamIDs of the demo of $SOURCE_MATCH_ID)"
echo "local-match: upload the real demo to it: POST /api/v1/matches/$LOCAL_MATCH_ID/demo/upload"
if [ ! -f "$DEMO_FILE" ]; then
    echo "local-match: note: $DEMO_FILE is missing, so the fake cannot serve the demo to an import of this match (an upload does not need it)"
fi
