"""Lista los módulos VBA del .xlsm con un lector propio y busca cadenas prohibidas. Código de salida 1 si falla."""
import re
import struct
import sys
import zipfile

FORBIDDEN = [r"gmail", r"\.Send\b", r"\bKill\b", r"GetDefaultFolder", r"mondefamme", r"3stud10", r"Recuperacion"]


def cfb_streams(data):
    ss = 1 << struct.unpack_from("<H", data, 30)[0]; mss = 1 << struct.unpack_from("<H", data, 32)[0]
    ndifat = struct.unpack_from("<I", data, 44)[0]; dir1 = struct.unpack_from("<I", data, 48)[0]
    minicut = struct.unpack_from("<I", data, 56)[0]; mfat1 = struct.unpack_from("<I", data, 60)[0]
    difat1 = struct.unpack_from("<I", data, 68)[0]; ndif = struct.unpack_from("<I", data, 72)[0]
    sector = lambda n: data[(n + 1) * ss:(n + 2) * ss]
    difat = list(struct.unpack_from("<109I", data, 76)); s = difat1
    while s not in (0xFFFFFFFE, 0xFFFFFFFF) and ndif > 0:
        sec = sector(s); difat += list(struct.unpack_from(f"<{ss // 4 - 1}I", sec, 0)); s = struct.unpack_from("<I", sec, ss - 4)[0]; ndif -= 1
    fat = []
    for f in difat[:ndifat]:
        if f in (0xFFFFFFFE, 0xFFFFFFFF): continue
        fat += list(struct.unpack_from(f"<{ss // 4}I", sector(f), 0))
    def chain(start):
        out = []; s = start
        while s not in (0xFFFFFFFE, 0xFFFFFFFF) and len(out) < 10 ** 6: out.append(s); s = fat[s]
        return out
    read_chain = lambda st, sz: b"".join(sector(s) for s in chain(st))[:sz]
    dirbytes = b"".join(sector(s) for s in chain(dir1)); entries = []
    for i in range(len(dirbytes) // 128):
        e = dirbytes[i * 128:(i + 1) * 128]; nl = struct.unpack_from("<H", e, 64)[0]
        entries.append((e[:max(nl - 2, 0)].decode("utf-16-le", "ignore"), e[66], struct.unpack_from("<I", e, 116)[0], struct.unpack_from("<Q", e, 120)[0]))
    root = entries[0]; ministream = read_chain(root[2], root[3]); minifat = []
    for s in chain(mfat1): minifat += list(struct.unpack_from(f"<{ss // 4}I", sector(s), 0))
    def read_mini(start, size):
        out = b""; s = start
        while s not in (0xFFFFFFFE, 0xFFFFFFFF) and len(out) < 10 ** 7: out += ministream[s * mss:(s + 1) * mss]; s = minifat[s]
        return out[:size]
    return {n: (read_mini(st, sz) if sz < minicut else read_chain(st, sz)) for n, t, st, sz in entries if t == 2}


def decompress(buf):
    pos = 1; out = bytearray()
    while pos < len(buf):
        hdr = struct.unpack_from("<H", buf, pos)[0]; pos += 2
        size = (hdr & 0x0FFF) + 3; flag = (hdr >> 15) & 1; chunk_end = min(pos - 2 + size, len(buf)); start_out = len(out)
        if not flag: out += buf[pos:pos + 4096]; pos += 4096; continue
        while pos < chunk_end:
            fb = buf[pos]; pos += 1
            for bit in range(8):
                if pos >= chunk_end: break
                if not (fb >> bit) & 1: out.append(buf[pos]); pos += 1
                else:
                    tok = struct.unpack_from("<H", buf, pos)[0]; pos += 2
                    dec = len(out) - start_out; bc = max(4, (dec - 1).bit_length()); lm = 0xFFFF >> bc
                    length = (tok & lm) + 3; off = (tok >> (16 - bc)) + 1
                    for _ in range(length): out.append(out[-off])
    return bytes(out)


def modules(path):
    data = zipfile.ZipFile(path).read("xl/vbaProject.bin")
    streams = cfb_streams(data)
    dirs = decompress(streams["dir"]); pos = 0; mods = []; cur = {}
    while pos + 6 <= len(dirs):
        rid = struct.unpack_from("<H", dirs, pos)[0]
        if rid == 0x0009: pos += 12; continue
        sz = struct.unpack_from("<I", dirs, pos + 2)[0]; pos += 6; val = dirs[pos:pos + sz]; pos += sz
        if rid == 0x0019: cur = {"name": val.decode("cp1252", "ignore")}
        elif rid == 0x001A: cur["stream"] = val.decode("cp1252", "ignore")
        elif rid == 0x0031: cur["offset"] = struct.unpack_from("<I", val, 0)[0]
        elif rid == 0x002B: mods.append(cur); cur = {}
        elif rid == 0x0010: break
    out = {}
    for m in mods:
        raw = streams.get(m.get("stream", m["name"]))
        out[m["name"]] = decompress(raw[m["offset"]:]).decode("cp1252", "ignore") if raw else ""
    return out


if __name__ == "__main__":
    mods = modules(sys.argv[1])
    bad = []
    for name, src in mods.items():
        for pat in FORBIDDEN:
            if re.search(pat, src):
                bad.append((name, pat))
    print(f"{sys.argv[1]}: {len(mods)} módulos VBA; procedimientos DC/Tab: {'abrir_Cal_Cir_Ele_DC' in mods.get('Acceso_Menus', '')}; cadenas prohibidas: {bad}")
    sys.exit(1 if bad or len(mods) < 49 else 0)
