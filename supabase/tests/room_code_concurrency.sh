#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

workers=8
rooms_per_worker=25

for worker in $(seq 1 "$workers"); do
  (
    for _ in $(seq 1 "$rooms_per_worker"); do
      psql -X -qAt -v ON_ERROR_STOP=1 \
        -c "select btrim((public.create_team_room(1001, '{}'::jsonb)).code::text);" \
        >> "$tmp_dir/codes-$worker"
    done
  ) &
done
wait

cat "$tmp_dir"/codes-* > "$tmp_dir/codes"
expected=$((workers * rooms_per_worker))
actual="$(wc -l < "$tmp_dir/codes" | tr -d ' ')"
if [ "$actual" -ne "$expected" ]; then
  echo "expected $expected codes, got $actual"
  exit 1
fi

if grep -Ev '^[A-Z0-9]{6}$' "$tmp_dir/codes"; then
  echo "invalid room code returned during concurrent creation"
  exit 1
fi

duplicates="$(sort "$tmp_dir/codes" | uniq -d)"
if [ -n "$duplicates" ]; then
  printf 'duplicate room codes under concurrency:\n%s\n' "$duplicates"
  exit 1
fi

echo "PASS: $actual concurrent room creations returned unique six-character codes"
