#!/usr/bin/env bash
# Construye la calculadora completa desde el original: catálogo → cirugía XML → imágenes/menús → VBA → recálculo → verificación.
#   FIDELITY=1 tools/mest-rebuild/build.sh   (modo fidelidad: reproduce las constantes del MEST para verificar)
#   tools/mest-rebuild/build.sh              (modo producción: correcciones ENNCO)
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
S="${MEST_SCRATCH:-/tmp/claude-1001/-home-atlas/1134cca2-8c95-45d3-9f1b-8781457957b6/scratchpad}"
ORIG="${MEST_ORIG:-$S/excel/mest.xlsm}"; B="${MEST_BUILD:-$S/build}"; mkdir -p "$B"
PY=/home/atlas/.local/opt/pyenv-mest/venv/bin/python
PWFILE="/home/atlas/[2026-08-03] Ennco/🔐 Secretos/[2026-09-12] Contraseña de protección de hojas · Calculadora Solar ENNCO.txt"
LOGO="/home/atlas/[2026-08-03] Ennco/🎨 Assets/Ennco Logo PNG.jpeg"
TAG="${FIDELITY:+fidelidad}"; TAG="${TAG:-produccion}"
cd "$T/catalog" && for g in gen_*.py; do python3 "$g" >/dev/null; done
cd "$T"
python3 apply.py --in "$ORIG" --catalog "$S"/wt-mest/build/cat_*.json --out "$B/v1-$TAG.xlsm"
python3 finalize.py --in "$B/v1-$TAG.xlsm" --out "$B/v2-$TAG.xlsm" --images "$B/img"
$PY vba_patch.py --in "$B/v2-$TAG.xlsm" --out "$B/calculadora-$TAG.xlsm" --password-file "$PWFILE" --export "$B/vba-original"
python3 vba_check.py "$B/calculadora-$TAG.xlsm"
./recalc.sh "$B/calculadora-$TAG.xlsm" "$B/recalc" >/dev/null
python3 verify.py --original "$ORIG" --recalc "$B/recalc/calculadora-$TAG.xlsx" --allow "$S/pruebas_permitidas.json" --report "$B/verificacion-$TAG.md" --show 15 || true
python3 golden.py "$B/recalc/calculadora-$TAG.xlsx" "/home/atlas/[2026-08-03] Ennco/📋 Documentación/🧮 Calculadora Solar/pruebas/golden-cases.json" || true
