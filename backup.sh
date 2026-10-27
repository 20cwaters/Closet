#!/usr/bin/env bash
# Back up Closet: a consistent SQLite copy (sqlite3 .backup) plus the images folder.
#
#   ./backup.sh /path/to/backups/closet        # keeps the newest 14 snapshots
#   ./backup.sh /path/to/backups/closet 30     # keeps 30
#
# Each run writes <target>/closet-YYYY-MM-DD_HHMM/{closet.db,images/}. Images never change
# once written, so snapshots hard-link unchanged files to the previous one: each extra
# night costs only the photos added that day. Safe to run while the app is in use.
set -euo pipefail

DEST=${1:?usage: backup.sh <target-dir> [snapshots-to-keep]}
KEEP=${2:-14}
HERE=$(cd "$(dirname "$0")" && pwd)
DATA="$HERE/data"
STAMP=$(date +%Y-%m-%d_%H%M)
SNAP="$DEST/closet-$STAMP"
IMAGE=closet:local   # the app image has the sqlite3 CLI; works whether or not the app is running

mkdir -p "$DEST"
[ -e "$SNAP" ] && { echo "backup: $SNAP already exists" >&2; exit 1; }
mkdir "$SNAP"

# 1. Database: an online backup via SQLite's own .backup, then an integrity check.
TMP=".backup-$STAMP.db"
docker run --rm --user "$(id -u):$(id -g)" -v "$DATA:/data" --entrypoint sqlite3 "$IMAGE" \
  /data/closet.db ".backup '/data/$TMP'"
CHECK=$(docker run --rm --user "$(id -u):$(id -g)" -v "$DATA:/data" --entrypoint sqlite3 "$IMAGE" \
  "/data/$TMP" "PRAGMA integrity_check;")
if [ "$CHECK" != "ok" ]; then
  rm -f "$DATA/$TMP"
  rm -rf "$SNAP"
  echo "backup: integrity check failed: $CHECK" >&2
  exit 1
fi
mv "$DATA/$TMP" "$SNAP/closet.db"

# 2. Images, hard-linked against the previous snapshot. (data/models is skipped: rembg
#    re-downloads it.)
PREV=$(find "$DEST" -maxdepth 1 -type d -name 'closet-*' ! -path "$SNAP" | sort | tail -n 1)
rsync -a --delete ${PREV:+--link-dest="$PREV/images"} "$DATA/images/" "$SNAP/images/"
ln -sfn "$(basename "$SNAP")" "$DEST/latest"

# 3. Keep the newest $KEEP snapshots.
find "$DEST" -maxdepth 1 -type d -name 'closet-*' | sort | head -n "-$KEEP" | xargs -r rm -rf

echo "backup: $SNAP ($(du -sh "$SNAP" | cut -f1), $(find "$SNAP/images" -type f | wc -l) images)"
