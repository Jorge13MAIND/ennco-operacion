# mest-rebuild · reconstrucción de la Calculadora Solar ENNCO (MEST PROGRAM 2.0)

Herramientas con las que se reconstruyó el .xlsm de cálculos solares de ENNCO a partir del rescate sin fórmulas (septiembre 2026).
Sin dependencias fuera de la biblioteca estándar salvo `vba_patch.py` (pyOpenVBA) y `make_images.py` (Pillow), que corren en el venv `~/.local/opt/pyenv-mest`.
El recálculo de verificación usa LibreOffice AppImage (`~/.local/opt/libreoffice`).

- `catalog/gen_*.py` · generan el catálogo de fórmulas (JSON) hoja por hoja. `FIDELITY=1` usa las constantes del MEST.
- `apply.py` · cirugía XML: inserta `<f>` en el .xlsm original conservando todo lo demás.
- `finalize.py` · imágenes ENNCO, macros de los botones DC/Tab, hoja de notas, hoja activa.
- `make_images.py` · genera las imágenes ENNCO del mismo tamaño que las de MEST.
- `vba_patch.py` · reescribe los módulos VBA tóxicos o desfasados; `vba_check.py` los lee sin Office y busca cadenas prohibidas.
- `recalc.sh` + `verify.py` · recalculan con LibreOffice y comparan celda por celda con el original (lista de diferencias permitidas).
- `golden.py` · casos de referencia. `build.sh` · todo el flujo.

Evidencia y entregables en `[2026-08-03] Ennco/📋 Documentación/🧮 Calculadora Solar/`.
