"""Builds the sakura theme's images in public/themes/sakura from the source PNGs in design/sakura/:
petal-1..4 (each petal of the petal photo on its own), branch-day / branch-night (the hanging branch without its loose
petals; the night copy without the white sky haze the cut-out kept), sprig-1..3 (flower clusters for the top bar).
Usage (Pillow, numpy and scipy): python scripts/sakura-assets.py design/sakura public/themes/sakura [preview dir]"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1]
OUT = sys.argv[2]
PREV = sys.argv[3] if len(sys.argv) > 3 else None

# petals
im = np.array(Image.open(f"{SRC}/petals.png").convert("RGBA"))
lab, n = ndimage.label(im[:, :, 3] > 8)
sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
keep = [i + 1 for i, s in enumerate(sizes) if s > 500]
objs = ndimage.find_objects(lab); boxes = sorted(((objs[k - 1], k) for k in keep), key=lambda b: b[0][0].start)
for i, (sl, k) in enumerate(boxes, 1):
    sub = im[sl].copy()
    sub[lab[sl] != k, 3] = 0
    p = Image.fromarray(sub)
    p.thumbnail((112, 112), Image.LANCZOS)
    p.save(f"{OUT}/petal-{i}.webp", quality=92, method=6)
    print("petal", i, p.size)

# branch
b = np.array(Image.open(f"{SRC}/branch.png").convert("RGBA")).astype(np.float32)
al = b[:, :, 3]
lab, n = ndimage.label(ndimage.binary_dilation(al > 24, iterations=3))
sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
main = sizes.max()
loose = [i + 1 for i, s in enumerate(sizes) if s < main * 0.03]
b[np.isin(lab, loose), 3] = 0
print("branch: removed", len(loose), "loose pieces of", n)
# Hot magenta specks of the cut-out: pulled back to the blossom pink.
r, g, bl, al = b[:, :, 0], b[:, :, 1], b[:, :, 2], b[:, :, 3]
hot = (r > 180) & (g < 110) & (bl > 90)
b[hot, 1] = np.maximum(g[hot], r[hot] * 0.62)
day = Image.fromarray(b.clip(0, 255).astype(np.uint8))
# The top right corner of the photo holds a cut piece of another flower: cut away.
arr = np.array(day); arr[:70, 900:, 3] = 0; arr[:360, 905:, 3] = 0; day = Image.fromarray(arr)
night = b.copy()
r, g, bl, al = night[:, :, 0], night[:, :, 1], night[:, :, 2], night[:, :, 3]
lum = 0.3 * r + 0.59 * g + 0.11 * bl
pink = r - g
haze = (al < 235) & (pink < 30) & (lum > 115)
night[haze, 3] *= 0.06
soft = (al < 235) & (pink >= 22) & (pink < 40) & (lum > 170)
night[soft, 3] *= 0.6
na = np.array(day).astype(np.float32); na[:, :, 3] = np.minimum(na[:, :, 3], night[:, :, 3]); night_img = Image.fromarray(na.clip(0, 255).astype(np.uint8))
for name, img in (("branch-day", day), ("branch-night", night_img)):
    small = img.resize((600, round(600 * img.height / img.width)), Image.LANCZOS)
    small.save(f"{OUT}/{name}.webp", quality=86, method=6)
    print(name, small.size)
    for bgname, bg in (("light", (246, 221, 226)), ("dark", (34, 18, 30))) if PREV else ():
        c = Image.new("RGBA", small.size, bg + (255,)); c.alpha_composite(small); c.convert("RGB").save(f"{PREV}/{name}_{bgname}.png")

# sprigs: flower clusters with a bit of twig
for i, box in enumerate([(140, 550, 510, 840), (540, 1030, 970, 1340), (470, 270, 830, 640)], 1):
    s = night_img.crop(box)
    s = s.crop(s.getbbox())
    s.thumbnail((140, 140), Image.LANCZOS)
    s.save(f"{OUT}/sprig-{i}.webp", quality=90, method=6)
    print("sprig", i, s.size)
    if PREV:
        c = Image.new("RGBA", s.size, (246, 221, 226, 255)); c.alpha_composite(s); c.convert("RGB").save(f"{PREV}/sprig-{i}.png")
