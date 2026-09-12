#!/usr/bin/env bash
# Recalcula un .xlsm/.xlsx con LibreOffice headless (AppImage sin root) y deja un .xlsx desechable en OUTDIR.
#   tools/mest-rebuild/recalc.sh build/v1.xlsm build/recalc/
set -euo pipefail
IN="$1"; OUT="${2:-build/recalc}"; mkdir -p "$OUT"
LO=/home/atlas/.local/opt/libreoffice/squashfs-root/AppRun
LOHOME=/home/atlas/.local/opt/libreoffice/home
HOME="$LOHOME" "$LO" --headless --norestore --nologo --convert-to xlsx --outdir "$OUT" "$IN" >/dev/null
echo "$OUT/$(basename "${IN%.*}").xlsx"
