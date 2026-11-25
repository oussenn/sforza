"""Builds each theme's logo from its transparent portrait in design/<theme>/logo.png, framed like the standard logo
(public/logo.png: the portrait centred, its longer side 85 % of the square):
  sakura, terminal, space -> public/themes/<theme>/logo.webp (256 px) and favicon.png (64 px)
Standard and custom show public/logo.png and public/favicon.png.
Usage (Pillow): python scripts/logos.py [preview.png]"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = ('sakura', 'terminal', 'space')


def framed(src, size):
    im = Image.open(src).convert('RGBA')
    # The visible portrait, without the near-invisible fringe of the cut-out.
    im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox())
    scale = size * 0.85 / max(im.size)
    p = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(p, ((size - p.width) // 2, (size - p.height) // 2))
    return out


def save(img, path):
    if path.endswith('.webp'):
        img.save(path, quality=88, method=6)
    else:
        img.save(path, optimize=True)
    print(os.path.relpath(path, ROOT), img.size[0], os.path.getsize(path), 'bytes')


sheet = [Image.open(os.path.join(ROOT, 'public', 'logo.png')).convert('RGBA')]
for theme in THEMES:
    src = os.path.join(ROOT, 'design', theme, 'logo.png')
    out = os.path.join(ROOT, 'public', 'themes', theme)
    os.makedirs(out, exist_ok=True)
    logo = framed(src, 256)
    save(logo, os.path.join(out, 'logo.webp'))
    save(framed(src, 64), os.path.join(out, 'favicon.png'))
    sheet.append(logo)

if len(sys.argv) > 1:
    prev = Image.new('RGBA', (276 * len(sheet) + 20, 296 * 2), (0, 0, 0, 0))
    for row, bg in enumerate(((246, 244, 240), (24, 24, 28))):
        ImageDraw.Draw(prev).rectangle((0, row * 296, prev.width, row * 296 + 295), fill=bg + (255,))
        for i, s in enumerate(sheet):
            prev.alpha_composite(s, (20 + i * 276, row * 296 + 20))
    prev.save(sys.argv[1])
