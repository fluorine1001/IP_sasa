#!/usr/bin/env bash
# Solve every stage from scratch (no reference values used) and print one line each.
cd "$(dirname "$0")/../.."
for f in data/stages/*.json; do
  o=$(node -e "console.log(require('./$f').order)")
  timeout "${PER_STAGE:-600}" node scripts/research/solution-atlas.mjs --order=$o --seconds=1 --grid --workers=2 \
    --tb=12 --ab=12 --pb=8 --golden=6 --beam=16 --goal-every=0.2 --phase-window=8 --polish=16 2>&1 \
    | grep '"order"' | head -1 || echo "{\"order\":$o,\"timeout\":true}"
done
