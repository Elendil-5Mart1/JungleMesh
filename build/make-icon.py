# Generates the JungleMesh logo: spider web (spokes + sagging rings), chamfered corner like the windows
import math
from PIL import Image, ImageDraw

S = 1024  # reference grid
C = S / 2
SPOKES = 8
RINGS = [0.20, 0.40, 0.58, 0.76, 0.92]  # relative spokes (from S/2 * 0.86)
R = S / 2 * 0.80
SAG = 0.16  # how much the ring sags between two spokes
TEAL, MAGENTA, BG = (31, 209, 200), (255, 6, 181), (13, 17, 20)
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
def svg():
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="256" height="256">']
    out.append(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in bg_poly())}" fill="rgb{BG}"/>')
    out.append(f'<g fill="none" stroke="rgb{TEAL}" stroke-linecap="round" stroke-linejoin="round">')
    out.append('<g stroke-width="18" opacity="0.95">' + ''.join(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>' for a, b in spokes) + '</g>')
    out.append('<g stroke-width="15">' + ''.join(f'<path d="M{p0[0]:.1f} {p0[1]:.1f}Q{c[0]:.1f} {c[1]:.1f} {p1[0]:.1f} {p1[1]:.1f}"/>' for p0, c, p1 in rings) + '</g></g>')
    hx, hy = pt(R * RINGS[2], 1)
    out.append(f'<circle cx="{hx:.1f}" cy="{hy:.1f}" r="34" fill="rgb{MAGENTA}"/>')
    out.append('</svg>')
    return '\n'.join(out)

# --- PNG (4x supersampled, then downscaled)
def png(size):
    k = 2
    img = Image.new('RGBA', (S*k, S*k), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(x*k, y*k) for x, y in bg_poly()], fill=BG + (255,))
    for a, b in spokes:
        d.line([(a[0]*k, a[1]*k), (b[0]*k, b[1]*k)], fill=TEAL, width=18*k)
    for p0, c, p1 in rings:
        d.line([(x*k, y*k) for x, y in quad(p0, c, p1)], fill=TEAL, width=15*k, joint='curve')
    hx, hy = pt(R * RINGS[2], 1)
    d.ellipse([(hx-34)*k, (hy-34)*k, (hx+34)*k, (hy+34)*k], fill=MAGENTA)
    return img.resize((size, size), Image.LANCZOS)

open('build/icon.svg', 'w', encoding='utf-8').write(svg())
big = png(512)
big.save('build/icon.png')
big.save('build/icon.ico', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])
print('ok')
