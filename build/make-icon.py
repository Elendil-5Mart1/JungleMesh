# Generates the JungleMesh logo: spider web (spokes + sagging rings), chamfered corner like the windows
# Usage: python build/make-icon.py            → desktop icons (build/icon.svg|png|ico, also the README logo)
#                                               + the title bar logo (src/renderer/src/assets/logo.svg)
#        python build/make-icon.py --mobile   → Android/iOS icons (mobile/assets)
# White web everywhere since 2026-11-23 (Dhyl: it looks better than teal); the magenta dot stays.
import math
import sys
from PIL import Image, ImageDraw

S = 1024  # reference grid
C = S / 2
SPOKES = 8
RINGS = [0.20, 0.40, 0.58, 0.76, 0.92]  # relative spokes (from S/2 * 0.86)
R = S / 2 * 0.80
SAG = 0.16  # how much the ring sags between two spokes
TEAL, MAGENTA, BG = (31, 209, 200), (255, 6, 181), (13, 17, 20)
WHITE = (255, 255, 255)
rot = -math.pi / 2 + math.pi / SPOKES  # offset spokes: no perfectly vertical spoke, more organic

def pt(r, i):
    a = rot + i * 2 * math.pi / SPOKES
    return (C + r * math.cos(a), C + r * math.sin(a))

def quad(p0, c, p1, n=24):
    return [((1-t)**2*p0[0]+2*(1-t)*t*c[0]+t*t*p1[0], (1-t)**2*p0[1]+2*(1-t)*t*c[1]+t*t*p1[1]) for t in (k/n for k in range(n+1))]

spokes = [(pt(R * 0.08, i), pt(R, i)) for i in range(SPOKES)]
rings = []  # each segment: (p0, control, p1, spoke)
for rr in RINGS:
    r = R * rr
    for i in range(SPOKES):
        p0, p1 = pt(r, i), pt(r, i + 1)
        mid = pt(r * (1 - SAG * (1 - rr * 0.5)), i + 0.5)  # the control point pulls towards the center
        ctrl = (2*mid[0]-(p0[0]+p1[0])/2, 2*mid[1]-(p0[1]+p1[1])/2)  # control point such that the curve passes through `mid`
        rings.append((p0, ctrl, p1))

# Background: rounded square with a chamfered bottom-right corner
def bg_poly(m=0, cut=190, rad=70):
    r = 36
    pts = [(m+r, m), (S-m-r, m), (S-m, m+r), (S-m, S-m-cut), (S-m-cut, S-m), (m+r, S-m), (m, S-m-r), (m, m+r)]
    return pts

# --- SVG
def svg(web=WHITE):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="256" height="256">']
    out.append(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in bg_poly())}" fill="rgb{BG}"/>')
    out.append(f'<g fill="none" stroke="rgb{web}" stroke-linecap="round" stroke-linejoin="round">')
    out.append('<g stroke-width="18" opacity="0.95">' + ''.join(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>' for a, b in spokes) + '</g>')
    out.append('<g stroke-width="15">' + ''.join(f'<path d="M{p0[0]:.1f} {p0[1]:.1f}Q{c[0]:.1f} {c[1]:.1f} {p1[0]:.1f} {p1[1]:.1f}"/>' for p0, c, p1 in rings) + '</g></g>')
    hx, hy = pt(R * RINGS[2], 1)
    out.append(f'<circle cx="{hx:.1f}" cy="{hy:.1f}" r="34" fill="rgb{MAGENTA}"/>')
    out.append('</svg>')
    return '\n'.join(out)

# --- PNG (2x supersampled, then downscaled)
# bg: 'chamfer' (the window shape), 'square' (full, opaque: iOS refuses transparency) or None (transparent)
# zoom < 1 shrinks the web towards the center (Android crops the adaptive foreground to a circle/squircle)
def png(size, web=WHITE, bg='chamfer', zoom=1.0, dot=MAGENTA):
    k = 2
    img = Image.new('RGBA', (S*k, S*k), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg == 'chamfer':
        d.polygon([(x*k, y*k) for x, y in bg_poly()], fill=BG + (255,))
    elif bg == 'square':
        d.rectangle([0, 0, S*k, S*k], fill=BG + (255,))
    z = lambda p: ((C + (p[0] - C) * zoom) * k, (C + (p[1] - C) * zoom) * k)
    for a, b in spokes:
        d.line([z(a), z(b)], fill=web, width=round(18*k*zoom))
    for p0, c, p1 in rings:
        d.line([z(p) for p in quad(p0, c, p1)], fill=web, width=round(15*k*zoom), joint='curve')
    if dot:
        hx, hy = z(pt(R * RINGS[2], 1))
        r = 34 * k * zoom
        d.ellipse([hx-r, hy-r, hx+r, hy+r], fill=dot)
    return img.resize((size, size), Image.LANCZOS)

def desktop():
    for path in ('build/icon.svg', 'src/renderer/src/assets/logo.svg'):  # the same drawing in the title bar
        open(path, 'w', encoding='utf-8').write(svg())
    big = png(512)
    big.save('build/icon.png')
    big.save('build/icon.ico', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])

# Android adaptive icon = background layer + foreground layer; only the central 66% of the foreground
# is always visible (the launcher crops it to a circle, squircle…): the web is shrunk to fit in it.
# Monochrome = Android 13 "themed icons": only its shape (alpha) is used, the system colors it.
def mobile():
    a = 'mobile/assets/'
    png(1024, WHITE, 'square', 0.86).convert('RGB').save(a + 'icon.png')
    png(512, WHITE, None, 0.62).save(a + 'android-icon-foreground.png')
    Image.new('RGBA', (512, 512), BG + (255,)).save(a + 'android-icon-background.png')
    png(432, WHITE, None, 0.62, dot=WHITE).save(a + 'android-icon-monochrome.png')
    png(1024, WHITE, None, 0.9).save(a + 'splash-icon.png')
    png(48, WHITE, 'chamfer').save(a + 'favicon.png')
    # Play Store listing: 512×512 PNG, full square (the Play Store rounds the corners itself), < 1 MB
    import os
    os.makedirs('mobile/store', exist_ok=True)
    png(512, WHITE, 'square', 0.86).save('mobile/store/icon-512.png')

if __name__ == '__main__':
    mobile() if '--mobile' in sys.argv else desktop()
    print('ok')
