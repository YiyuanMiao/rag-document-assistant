#!/usr/bin/env bash
# Keeps Isengard temporary credentials fresh in ~/.aws/credentials so long-running
# Bedrock jobs survive token rotation. Run once in a SEPARATE terminal:
#     ./refresh-creds.sh
# The app (BEDROCK_CREDS=ini-refresh) re-reads the file periodically and picks up
# whatever this loop last wrote. Amazon-employee only (uses `ada` + Midway).
set -u
ACCOUNT="${ISENGARD_ACCOUNT:-701372699413}"
ROLE="${ISENGARD_ROLE:-Admin}"
INTERVAL="${REFRESH_INTERVAL:-600}"   # seconds between refreshes (default 10 min)

echo "Refreshing creds for account=$ACCOUNT role=$ROLE every ${INTERVAL}s. Ctrl-C to stop."
while true; do
  if ada credentials update --account "$ACCOUNT" --role "$ROLE" --provider isengard --once; then
    echo "[$(date '+%H:%M:%S')] credentials refreshed"
  else
    echo "[$(date '+%H:%M:%S')] refresh FAILED (is your Midway session valid? run 'mwinit')"
  fi
  sleep "$INTERVAL"
done
