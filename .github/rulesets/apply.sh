#!/usr/bin/env bash
# Create or update the repo's rulesets from the JSON next to this script.
#
# Rulesets need a public repo or a paid plan: on a free private repo every call
# here 404s or 403s. Run it once the repo is public.
#
#   ./.github/rulesets/apply.sh            # apply to VektorNode/selva
#   REPO=owner/name ./.github/rulesets/apply.sh
set -euo pipefail

REPO="${REPO:-VektorNode/selva}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Match on name so re-running updates in place instead of creating duplicates —
# the API happily accepts two rulesets with the same name.
existing="$(gh api "repos/$REPO/rulesets" --jq '[.[] | {name, id}]')"

for file in "$DIR"/*.json; do
	name="$(jq -r .name "$file")"
	id="$(jq -r --arg n "$name" '.[] | select(.name == $n) | .id' <<<"$existing")"

	if [ -n "$id" ]; then
		echo "updating '$name' (id $id)"
		gh api -X PUT "repos/$REPO/rulesets/$id" --input "$file" >/dev/null
	else
		echo "creating '$name'"
		gh api -X POST "repos/$REPO/rulesets" --input "$file" >/dev/null
	fi
done

echo
gh api "repos/$REPO/rulesets" --jq '.[] | "\(.name)\t\(.target)\t\(.enforcement)"'
