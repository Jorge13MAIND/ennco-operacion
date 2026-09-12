"""Genera las imágenes ENNCO que sustituyen a las de MEST, con el mismo tamaño en píxeles que las originales.
    venv/bin/python make_images.py --logo "…/Ennco Logo PNG.jpeg" --source mest.xlsm --out build/img
"""
import argparse
import io
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LOGOS = ["image1", "image2", "image12", "image21", "image28", "image45", "image52", "image53"]
BANNER, FOOTER = "image59", "image61"
PHOTOS = ["image55", "image56", "image57"]
BLUE, YELLOW, PALE = (12, 58, 120), (245, 197, 24), (232, 238, 247)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def fit(logo, w, h, pad=0.06):
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    lw, lh = logo.size
    scale = min(w * (1 - pad) / lw, h * (1 - pad) / lh)
    r = logo.resize((max(1, int(lw * scale)), max(1, int(lh * scale))), Image.LANCZOS)
    canvas.paste(r, ((w - r.width) // 2, (h - r.height) // 2), r)
    return canvas


def round_logo(path):
    im = Image.open(path).convert("RGBA")
    # recorta el círculo azul sobre fondo transparente
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((int(w * 0.03), int(h * 0.02), int(w * 0.97), int(h * 0.98)), fill=255)
    im.putalpha(mask)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(args.source)
    logo = round_logo(args.logo)
    for name in LOGOS + PHOTOS + [BANNER, FOOTER]:
        orig = Image.open(io.BytesIO(z.read(f"xl/media/{name}.png")))
        w, h = orig.size
        if name in LOGOS:
            img = fit(logo, w, h)
        elif name in PHOTOS:
            img = Image.new("RGBA", (w, h), PALE)
            d = ImageDraw.Draw(img)
            small = fit(logo, int(w * 0.5), int(h * 0.55))
            img.paste(small, ((w - small.width) // 2, int(h * 0.06)), small)
            f = ImageFont.truetype(FONT, max(12, h // 14))
            txt = "Proyecto ENNCO · foto por agregar"
            tw = d.textlength(txt, font=f)
            d.text(((w - tw) / 2, h * 0.72), txt, fill=BLUE, font=f)
        elif name == BANNER:
            img = Image.new("RGBA", (w, h), PALE)
            d = ImageDraw.Draw(img)
            d.polygon([(0, 0), (int(h * 1.2), 0), (int(h * 2.4), h), (0, h)], fill=BLUE)
            d.polygon([(int(h * 1.2), 0), (int(h * 1.6), 0), (int(h * 2.8), h), (int(h * 2.4), h)], fill=YELLOW)
            f = ImageFont.truetype(FONTB, int(h * 0.42))
            d.text((w - d.textlength("ENNCO", font=f) - h * 0.4, h * 0.25), "ENNCO", fill=BLUE, font=f)
            small = fit(logo, int(h * 0.9), int(h * 0.9))
            img.paste(small, (w - int(d.textlength("ENNCO", font=f)) - int(h * 1.5), int(h * 0.05)), small)
        else:  # footer
            img = Image.new("RGBA", (w, h), PALE)
            d = ImageDraw.Draw(img)
            d.polygon([(w - int(h * 2.4), 0), (w, 0), (w, h), (w - int(h * 1.2), h)], fill=BLUE)
            d.polygon([(w - int(h * 2.8), 0), (w - int(h * 2.4), 0), (w - int(h * 1.2), h), (w - int(h * 1.6), h)], fill=YELLOW)
            f = ImageFont.truetype(FONT, int(h * 0.26))
            d.text((int(h * 0.25), int(h * 0.12)), "ENNCO · Energy Innovation Consulting", fill=BLUE, font=f)
            d.text((int(h * 0.25), int(h * 0.42)), "contacto@ennco.com.mx", fill=BLUE, font=f)
            d.text((int(h * 0.25), int(h * 0.70)), "www.ennco.com.mx", fill=BLUE, font=f)
        img.save(out / f"{name}.png")
        print(name, w, h)


if __name__ == "__main__":
    main()
