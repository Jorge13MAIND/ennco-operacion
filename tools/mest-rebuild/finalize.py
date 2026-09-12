"""Ajustes finales del paquete (sin tocar fórmulas):
  · asigna macros a los botones de Cal_Cir_Ele que no tenían (C. Directa, Centro de carga)
  · renombra la hoja Recuperacion → Notas_Reconstruccion
  · pone Inicio como hoja activa al abrir
  · sustituye imágenes MEST por las de ENNCO (carpeta --images: nombre.png → xl/media/nombre.png)
    python3 finalize.py --in build/v1.xlsm --out build/v2.xlsm --images build/img
"""
import argparse
import re
import zipfile
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--images")
    args = ap.parse_args()
    zin = zipfile.ZipFile(args.inp)
    patched = {}
    wb = zin.read("xl/workbook.xml").decode("utf-8")
    wb = wb.replace('name="Recuperacion"', 'name="Notas_Reconstruccion"')
    wb = re.sub(r'(<workbookView[^>]*?)firstSheet="\d+"', r'\1firstSheet="0"', wb)
    wb = re.sub(r'(<workbookView[^>]*?)activeTab="\d+"', r'\1activeTab="0"', wb)
    patched["xl/workbook.xml"] = wb.encode("utf-8")
    # botones de Cal_Cir_Ele (drawing3.xml)
    d3 = zin.read("xl/drawings/drawing3.xml").decode("utf-8")
    def set_macro(xml, shape_name, macro):
        pat = re.compile(r'(<xdr:sp\b)([^>]*)(>\s*<xdr:nvSpPr>\s*<xdr:cNvPr[^>]*name="' + re.escape(shape_name) + '")')
        def repl(m):
            attrs = re.sub(r'\s*macro="[^"]*"', "", m.group(2))
            return f'{m.group(1)} macro="{macro}"{attrs}{m.group(3)}'
        return pat.sub(repl, xml, count=1)
    d3 = set_macro(d3, "Rectángulo: esquinas redondeadas 4", "[0]!abrir_Cal_Cir_Ele_DC")
    d3 = set_macro(d3, "Rectángulo: esquinas redondeadas 7", "[0]!abrir_Cal_Cir_Ele_Tab")
    for pic, macro in [("Imagen 20", "[0]!abrir_Cal_Cir_Ele_DC"), ("Imagen 16", "[0]!abrir_Cal_Cir_Ele_Tab")]:
        pat = re.compile(r'(<xdr:pic\b)([^>]*)(>\s*<xdr:nvPicPr>\s*<xdr:cNvPr[^>]*name="' + re.escape(pic) + '")')
        d3 = pat.sub(lambda m: f'{m.group(1)} macro="{macro}"{re.sub(r"\\s*macro=\"[^\"]*\"", "", m.group(2))}{m.group(3)}', d3, count=1)
    patched["xl/drawings/drawing3.xml"] = d3.encode("utf-8")
    replaced = []
    if args.images:
        for p in Path(args.images).glob("*.png"):
            name = f"xl/media/{p.name}"
            if name in zin.namelist():
                patched[name] = p.read_bytes()
                replaced.append(p.name)
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, patched.get(item.filename, zin.read(item.filename)))
    print(f"{args.out}: hoja Notas_Reconstruccion, Inicio activa, botones DC/Tab con macro, imágenes sustituidas: {sorted(replaced)}")


if __name__ == "__main__":
    main()
