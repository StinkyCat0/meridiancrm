#!/bin/sh
#
# Online, WAL-safe snapshot of the Meridian SQLite database.
#
# Usage:
#   scripts/backup-sqlite.sh
#
# Configuration (environment):
#   DATABASE_URL   Prisma-style SQLite URL, e.g. file:/data/meridian.db or
#                  file:./dev.db. Relative paths resolve against the Prisma
#                  directory (apps/api/prisma), matching Prisma's behaviour.
#   DB_PATH        Explicit database file. Overrides DATABASE_URL.
#   BACKUP_DIR     Destination directory. Default: <repo>/backups.
#   PRISMA_DIR     Prisma directory used for relative URLs.
#                  Default: <repo>/apps/api/prisma.
#
# The snapshot is written to a temporary file in BACKUP_DIR, checked with
# PRAGMA integrity_check, chmod 600, and only then renamed into place. The
# target directory is created mode 700. The script refuses to run when the
# database file is missing. It never prints DATABASE_URL or credentials.
#
# Backup method: `sqlite3 DB ".backup OUT"` when the CLI is installed (safe
# with WAL and a live writer). Otherwise it falls back to `VACUUM INTO` through
# the repository's Prisma CLI. Verification uses sqlite3 when present, or
# Node's built-in node:sqlite (Node >= 22.5). If neither can verify the file,
# the script fails instead of keeping an unverified snapshot.
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")
PRISMA_DIR=${PRISMA_DIR:-"$REPO_ROOT/apps/api/prisma"}

die() {
  printf 'backup-sqlite: %s\n' "$*" >&2
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

  printf 'backup-sqlite: no sqlite3 or Node sqlite support available to verify the snapshot\n' >&2
  return 1
}

sql_quote() {
  # VACUUM INTO takes a SQL string literal; double embedded quotes.
  printf '%s' "$1" | sed "s/'/''/g"
}

DB=$(resolve_db_path)
[ -f "$DB" ] || die "database not found: $DB (set DB_PATH or DATABASE_URL)"
[ -r "$DB" ] || die "database is not readable: $DB"

BACKUP_DIR=${BACKUP_DIR:-"$REPO_ROOT/backups"}
mkdir -p -m 700 "$BACKUP_DIR" || die "could not create backup directory: $BACKUP_DIR"
[ -w "$BACKUP_DIR" ] || die "backup directory is not writable: $BACKUP_DIR"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/meridian-$stamp.db"
[ ! -e "$OUT" ] || die "refusing to overwrite existing backup: $OUT"

case $OUT in
  *"'"*) die "backup path must not contain a single quote: $OUT" ;;
esac

tmp="$OUT.tmp.$$"
rm -f "$tmp"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

if command -v sqlite3 >/dev/null 2>&1; then
  escaped_tmp=$(printf '%s' "$tmp" | sed "s/'/''/g")
  sqlite3 "$DB" ".backup '$escaped_tmp'" || die "sqlite3 .backup failed"
else
  prisma_bin=""
  if [ -x "$REPO_ROOT/node_modules/.bin/prisma" ]; then
    prisma_bin="$REPO_ROOT/node_modules/.bin/prisma"
  elif command -v prisma >/dev/null 2>&1; then
    prisma_bin=$(command -v prisma)
  fi

  # The npx path resolves from the current directory, which keeps a script
  # copied into a container (outside the repo tree) usable when the shell's
  # working directory is still the app package.
  if [ -n "$prisma_bin" ]; then
    printf "VACUUM INTO '%s';\n" "$(sql_quote "$tmp")" |
      "$prisma_bin" db execute --stdin --url "file:$DB" >/dev/null ||
      die "Prisma VACUUM INTO fallback failed"
  elif command -v npx >/dev/null 2>&1; then
    printf "VACUUM INTO '%s';\n" "$(sql_quote "$tmp")" |
      npx --no-install prisma db execute --stdin --url "file:$DB" >/dev/null ||
      die "Prisma VACUUM INTO fallback failed"
  else
    die "sqlite3 is not installed and the Prisma CLI was not found; install sqlite3 or run npm install"
  fi
fi

[ -s "$tmp" ] || die "snapshot is empty: $tmp"
verify_integrity "$tmp" || die "snapshot failed PRAGMA integrity_check; removed $tmp"
chmod 600 "$tmp"
mv "$tmp" "$OUT" || die "could not move snapshot into place: $OUT"
trap - EXIT HUP INT TERM

size=$(wc -c <"$OUT" | tr -d ' ')
printf 'Backup written: %s (%s bytes, integrity ok)\n' "$OUT" "$size"
