#!/bin/sh
#
# Restore a Meridian SQLite database from a snapshot taken by
# scripts/backup-sqlite.sh (or any other consistent SQLite backup).
#
# Usage:
#   scripts/restore-sqlite.sh [--force] <backup.db>
#   BACKUP_FILE=<backup.db> scripts/restore-sqlite.sh --force
#
# Without --force the script only validates the snapshot and prints the plan;
# it changes nothing and exits non-zero so a copy-paste cannot be mistaken for
# a completed restore.
#
# Before restoring: stop the API (and every other process using the database).
# The script refuses to touch a database that is open according to lsof, and
# refuses to proceed while -wal/-shm/-journal files exist because they may
# belong to a live writer. If the API is stopped and the files are stale after
# an unclean shutdown, set ALLOW_WAL_PRESENT=1 after confirming no process uses
# the database.
#
# The current database (and journals) are moved to
# <db>.pre-restore.<UTC timestamp>[.pid]. The verified snapshot is copied to a
# temporary file next to the target, chmod 600, and renamed into place. No
# secrets are printed.
#
# Configuration (environment):
#   DATABASE_URL   Prisma-style SQLite URL. Relative paths resolve against the
#                  Prisma directory, matching Prisma's behaviour.
#   DB_PATH        Explicit database file. Overrides DATABASE_URL.
#   BACKUP_FILE    Snapshot path when it is not passed as an argument.
#   PRISMA_DIR     Default: <repo>/apps/api/prisma.
#   ALLOW_WAL_PRESENT=1  Proceed even if -wal/-shm/-journal files exist.
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")
PRISMA_DIR=${PRISMA_DIR:-"$REPO_ROOT/apps/api/prisma"}

usage() {
  cat <<'EOF'
Usage: scripts/restore-sqlite.sh [--force] <backup.db>

  --force   Actually restore. Without it the script validates the snapshot and
            prints the plan only.
  -h, --help

Environment: DATABASE_URL, DB_PATH, BACKUP_FILE, PRISMA_DIR, ALLOW_WAL_PRESENT.
Stop the API before restoring.
EOF
}

die() {
  printf 'restore-sqlite: %s\n' "$*" >&2
  exit 1
}

abs_path() {
  case $1 in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$(pwd)" "$1" ;;
  esac
}

resolve_db_path() {
  if [ -n "${DB_PATH:-}" ]; then
    abs_path "$DB_PATH"
    return 0
  fi

  url=${DATABASE_URL:-}
  if [ -z "$url" ]; then
    printf '%s\n' "$PRISMA_DIR/dev.db"
    return 0
  fi

  case $url in
    file:*) path=${url#file:} ;;
    *) die "DATABASE_URL must use the file: scheme for a SQLite deployment" ;;
  esac
  path=${path%%\?*}
  [ -n "$path" ] || die "DATABASE_URL does not contain a database path"

  case $path in
    /*) printf '%s\n' "$path" ;;
    *) printf '%s/%s\n' "$PRISMA_DIR" "$path" ;;
  esac
}

verify_integrity() {
  file=$1

  if command -v sqlite3 >/dev/null 2>&1; then
    result=$(sqlite3 "$file" 'PRAGMA integrity_check;' 2>/dev/null) || return 1
    [ "$result" = "ok" ] || return 1
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node --no-warnings -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      try {
        const rows = db.prepare("PRAGMA integrity_check").all();
        if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
          process.exit(1);
        }
      } finally {
        db.close();
      }
    ' "$file"
    return $?
  fi

  printf 'restore-sqlite: no sqlite3 or Node sqlite support available to verify the snapshot\n' >&2
  return 1
}

force=0
backup=""
for arg in "$@"; do
  case $arg in
    --force) force=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    --*)
      usage >&2
      exit 2
      ;;
    *)
      [ -z "$backup" ] || {
        usage >&2
        exit 2
      }
      backup=$arg
      ;;
  esac
done

[ -n "$backup" ] || backup=${BACKUP_FILE:-}
[ -n "$backup" ] || {
  usage >&2
  exit 2
}

backup=$(abs_path "$backup")
[ -f "$backup" ] || die "backup not found: $backup"
[ -r "$backup" ] || die "backup is not readable: $backup"

DB=$(resolve_db_path)
db_dir=$(dirname -- "$DB")
[ -d "$db_dir" ] || die "target directory does not exist: $db_dir"
[ -w "$db_dir" ] || die "target directory is not writable: $db_dir"

if [ -e "$DB" ] && [ "$backup" -ef "$DB" ]; then
  die "backup and target database are the same file"
fi

verify_integrity "$backup" || die "backup failed PRAGMA integrity_check: $backup"

if [ "$force" -ne 1 ]; then
  cat <<EOF
Restore plan (dry run; nothing changed)

  backup: $backup
  target: $DB
  target exists: $([ -e "$DB" ] && printf 'yes' || printf 'no')
  pre-restore copy: $DB.pre-restore.<UTC timestamp>

The API must be stopped first. Re-run with --force to restore.
EOF
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  open_pids=$(lsof -t -- "$DB" "$DB-wal" "$DB-shm" "$DB-journal" 2>/dev/null || true)
  [ -z "$open_pids" ] ||
    die "database is open (pids: $open_pids); stop the API before restoring"
fi

wal_present=0
for suffix in -wal -shm -journal; do
  if [ -e "$DB$suffix" ]; then
    wal_present=1
  fi
done
if [ "$wal_present" -eq 1 ] && [ "${ALLOW_WAL_PRESENT:-0}" != "1" ]; then
  die "found -wal/-shm/-journal next to the target; stop the API and confirm no process uses the database (set ALLOW_WAL_PRESENT=1 for confirmed-stale files)"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
previous="$DB.pre-restore.$stamp"
[ ! -e "$previous" ] || previous="$previous.$$"
tmp="$DB.restore.$stamp.$$"
rm -f "$tmp"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

cp "$backup" "$tmp" || die "could not copy the snapshot next to the target"
chmod 600 "$tmp"
verify_integrity "$tmp" || die "copied snapshot failed integrity verification"

moved_wal=0
moved_shm=0
moved_journal=0
if [ -e "$DB-wal" ]; then
  mv "$DB-wal" "$previous-wal" || die "could not move aside $DB-wal"
  moved_wal=1
fi
if [ -e "$DB-shm" ]; then
  mv "$DB-shm" "$previous-shm" || die "could not move aside $DB-shm"
  moved_shm=1
fi
if [ -e "$DB-journal" ]; then
  mv "$DB-journal" "$previous-journal" || die "could not move aside $DB-journal"
  moved_journal=1
fi

if [ -e "$DB" ]; then
  if ! mv "$DB" "$previous"; then
    [ "$moved_wal" -eq 0 ] || mv "$previous-wal" "$DB-wal"
    [ "$moved_shm" -eq 0 ] || mv "$previous-shm" "$DB-shm"
    [ "$moved_journal" -eq 0 ] || mv "$previous-journal" "$DB-journal"
    die "could not move the current database aside"
  fi
  chmod 600 "$previous"
fi
[ ! -e "$previous-wal" ] || chmod 600 "$previous-wal"
[ ! -e "$previous-shm" ] || chmod 600 "$previous-shm"
[ ! -e "$previous-journal" ] || chmod 600 "$previous-journal"

if ! mv "$tmp" "$DB"; then
  [ ! -e "$previous" ] || mv "$previous" "$DB"
  [ "$moved_wal" -eq 0 ] || mv "$previous-wal" "$DB-wal"
  [ "$moved_shm" -eq 0 ] || mv "$previous-shm" "$DB-shm"
  [ "$moved_journal" -eq 0 ] || mv "$previous-journal" "$DB-journal"
  die "could not install the restored database"
fi

chmod 600 "$DB"
trap - EXIT HUP INT TERM

printf 'Restored: %s\n' "$DB"
printf 'Source:   %s\n' "$backup"
if [ -e "$previous" ]; then
  printf 'Previous database saved: %s\n' "$previous"
else
  printf 'Previous database: none (target did not exist)\n'
fi
printf 'Start the API and check /api/v1/health before sending traffic.\n'
