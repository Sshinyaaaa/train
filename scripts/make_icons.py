"""Home-screen icons for the PWA (PLAN.md §4g), rendered from the header emblem in site/index.html.

The emblem is pixel art: SVG paths made only of "MxYhWvHh-Wz" rectangles on a 16x18 grid. This
draws them onto a square night-sky tile with nearest-neighbour scaling, so the pixels stay crisp.

Usage: python scripts/make_icons.py   (needs Pillow; writes site/icons/*.png)
"""
import re

from PIL import Image

from gtfs_util import ROOT

SITE = ROOT / "site"
# light-theme emblem colours (site/style.css :root)
FILL = {"q1": "#7c1d35", "q2": "#1f4a8a", "q3": "#1f6b4a", "q4": "#a8770a",
        "rim": "#c99a2e", "ico": "#fff7e3", "glow": "#fff7e3", "flame": "#ffcf5c"}
BG = "#0e1714"                      # dark-theme page background
GRID_W, GRID_H = 16, 18


def emblem_rects():
    html = (SITE / "index.html").read_text(encoding="utf-8")
    svg = re.search(r'<svg class="emblem".*?</svg>', html, re.S).group(0)
    out = []
    for cls, d in re.findall(r'<path class="(\w+)" d="([^"]+)"', svg):
        for x, y, w, h in re.findall(r"M(\d+) (\d+)h(\d+)v(\d+)h-\d+z", d):
            out.append((FILL[cls], int(x), int(y), int(w), int(h)))
    return out


def render(size, scale_frac):
    """Emblem centred, its height = scale_frac of the tile, whole-pixel scaling."""
    img = Image.new("RGB", (size, size), BG)
    px = max(1, int(size * scale_frac) // GRID_H)
    ox, oy = (size - GRID_W * px) // 2, (size - GRID_H * px) // 2
    for colour, x, y, w, h in emblem_rects():
        img.paste(colour, (ox + x * px, oy + y * px, ox + (x + w) * px, oy + (y + h) * px))
    return img


def main():
    out = SITE / "icons"
    out.mkdir(exist_ok=True)
    render(192, 0.72).save(out / "icon-192.png", optimize=True)
    render(512, 0.72).save(out / "icon-512.png", optimize=True)
    render(512, 0.52).save(out / "maskable-512.png", optimize=True)   # inside the 80% safe zone
    render(180, 0.72).save(out / "apple-touch-icon.png", optimize=True)
    print("wrote", ", ".join(sorted(p.name for p in out.glob("*.png"))))


if __name__ == "__main__":
    main()
