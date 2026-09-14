"""Deja el proyecto VBA de un .xlsm en estado "solo fuente" para que Excel lo recompile al abrir.

Problema que corrige: pyOpenVBA conserva el p-code (PerformanceCache) original delante del codigo
fuente nuevo y deja _VBA_PROJECT con la version original y el cuerpo en ceros. Si la version de VBA
del usuario coincide, Excel intenta usar esa cache, la encuentra inconsistente y descarta el
proyecto completo ("No se puede ejecutar la macro ... Puede que la macro no este disponible").

Que hace ([MS-OVBA]):
  - cada modulo queda como fuente comprimida sin prefijo de p-code (MODULEOFFSET = 0),
  - _VBA_PROJECT = CC 61 FF FF 00 00 00 (sin cache, version 0xFFFF),
  - se eliminan los __SRP_* si existieran,
  - opcionalmente quita el candado de visualizacion del proyecto (lineas CMG/DPB/GC del PROJECT),
  - todo lo demas del paquete .xlsm se copia byte a byte.

    venv/bin/python vba_clean.py --in build/v3.xlsm --out build/v4.xlsm [--keep-lock]
"""
import argparse
import struct
import zipfile
from io import BytesIO

from pyopenvba.cfb import CFB
from pyopenvba.vba import compress, decompress, encode_mbcs, encoding_for_codepage, parse_vba_project


def rewrite_dir(raw_dir: bytes) -> bytes:
    """Pone MODULEOFFSET (0x0031) en 0 en cada modulo, sin tocar el resto de registros."""
    data = decompress(raw_dir)
    out = bytearray()
    i = 0
    n = 0
    while i < len(data):
        rid = struct.unpack_from("<H", data, i)[0]
        if rid == 0x0009:  # PROJECTVERSION: size fija de 4 bytes sin campo de longitud real
            out += data[i:i + 12]
            i += 12
            continue
        size = struct.unpack_from("<I", data, i + 2)[0]
        val = data[i + 6:i + 6 + size]
        if rid == 0x0031:
            val = b"\x00\x00\x00\x00"
            n += 1
        out += data[i:i + 6] + val
        i += 6 + size
        if rid == 0x0010:  # PROJECTTERMINATOR
            out += data[i:]
            break
    return compress(bytes(out)), n


def clean_bin(src: bytes, keep_lock: bool) -> tuple[bytes, dict]:
    cfb = CFB.from_bytes(src)
    project = parse_vba_project(cfb)
    enc = encoding_for_codepage(project.code_page)
    info = {"modules": 0, "offsets_reset": 0, "srp_dropped": 0, "unlocked": False}
    for m in project.modules:
        stream = compress(encode_mbcs(m.source, enc))
        cfb.write_stream_in_storage("VBA", m.stream_name, stream)
        info["modules"] += 1
    new_dir, info["offsets_reset"] = rewrite_dir(cfb.get_stream_in_storage("VBA", "dir"))
    cfb.write_stream_in_storage("VBA", "dir", new_dir)
    cfb.write_stream_in_storage("VBA", "_VBA_PROJECT", b"\xcc\x61\xff\xff\x00\x00\x00")
    try:
        srp = [s for s in cfb.list_streams_in_storage("VBA") if s.startswith("__SRP_")]
        cfb.drop_streams_in_storage("VBA", lambda s: s.startswith("__SRP_"))
        info["srp_dropped"] = len(srp)
    except KeyError:
        pass
    if not keep_lock:
        raw = cfb.get_stream("PROJECT")
        lines = raw.split(b"\r\n")
        kept = [l for l in lines if not (l.startswith(b"CMG=") or l.startswith(b"DPB=") or l.startswith(b"GC="))]
        if len(kept) != len(lines):
            cfb.write_stream("PROJECT", b"\r\n".join(kept))
            info["unlocked"] = True
    return cfb.to_bytes(), info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--keep-lock", action="store_true", help="conserva el candado de visualizacion del proyecto VBA")
    args = ap.parse_args()
    zin = zipfile.ZipFile(args.inp)
    new_bin, info = clean_bin(zin.read("xl/vbaProject.bin"), args.keep_lock)
    with zipfile.ZipFile(args.out, "w") as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/vbaProject.bin":
                data = new_bin
            zout.writestr(item, data, compress_type=item.compress_type)
    print(f"vbaProject.bin: {len(new_bin)} bytes | {info}")


if __name__ == "__main__":
    main()
