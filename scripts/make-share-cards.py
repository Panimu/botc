"""Link-preview cards for each character's share page (/you/<id>.html).

Writes resources/og/characters/<id>.jpg (1200x630) for every character in
data/characters.json: "I'm the <name>", the team, the character's share quote
(data/share-quotes.json) and their token,
in the style of resources/og/quiz.png. Needs Pillow and the Georgia font.
Rerun after adding characters or changing token art:

    python scripts/make-share-cards.py
"""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'resources', 'og', 'characters')
W, H, SS = 1200, 630, 2
NIGHT = (34, 25, 50)
EDGE = (20, 14, 31)
VELLUM = (243, 233, 210)
DIM = (207, 195, 170)
BRASS = (224, 185, 100)
DIAL = (110, 94, 140)
TEAM = {'townsfolk': ('Townsfolk', (143, 180, 238)), 'outsider': ('Outsider', (76, 194, 180)),
        'minion': ('Minion', (242, 149, 75)), 'demon': ('Demon', (240, 138, 142)),
        'traveller': ('Traveller', (224, 185, 100))}
SERIF = 'C:/Windows/Fonts/georgia.ttf'
SERIF_ITALIC = 'C:/Windows/Fonts/georgiai.ttf'


def font(size):
    return ImageFont.truetype(SERIF, size * SS)


def radial(size, centre, radius, inner, outer, power=1.0):
    gw, gh = size
    small = Image.new('RGB', (max(1, gw // 8), max(1, gh // 8)))
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            d = math.hypot((x * 8 - centre[0]) / radius[0], (y * 8 - centre[1]) / radius[1])
            t = min(1.0, d) ** power
            px[x, y] = tuple(round(inner[i] + (outer[i] - inner[i]) * t) for i in range(3))
    return small.resize(size, Image.BICUBIC)


def backdrop():
    w, h = W * SS, H * SS
    cx, cy = 0.79 * w, 0.5 * h
    bg = radial((w, h), (cx, cy), (w * 0.75, h * 1.1), (44, 33, 62), EDGE, 1.2)
    canvas = bg.convert('RGBA')
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    r = 250 * SS
    ImageDraw.Draw(glow).ellipse([cx - r, cy - r, cx + r, cy + r], fill=BRASS + (40,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(70 * SS)))
    draw = ImageDraw.Draw(canvas)
    for i in range(60):
        a = math.radians(i * 6 - 90)
        major = i % 5 == 0
        inner, outer = (220 if major else 227) * SS, 240 * SS
        draw.line([cx + inner * math.cos(a), cy + inner * math.sin(a), cx + outer * math.cos(a), cy + outer * math.sin(a)],
                  fill=BRASS if major else DIAL, width=(4 if major else 2) * SS)
    return canvas, (cx, cy)


def token(art_path, d):
    disc = radial((d, d), (d * 0.5, d * 0.38), (d * 0.62, d * 0.62), (251, 245, 230), (214, 193, 151), 1.4)
    mask = Image.new('L', (d, d), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, d - 1, d - 1], fill=255)
    tok = Image.new('RGBA', (d, d), (0, 0, 0, 0))
    tok.paste(disc, (0, 0), mask)
    ImageDraw.Draw(tok).ellipse([0, 0, d - 1, d - 1], outline=(74, 52, 26, 150), width=4 * SS)
    # The art has wide transparent margins: crop to what's drawn, then scale it
    # to fill about two-thirds of the token (up or down).
    icon = Image.open(art_path).convert('RGBA')
    icon = icon.crop(icon.getbbox())
    scale = d * 0.64 / max(icon.size)
    icon = icon.resize((round(icon.width * scale), round(icon.height * scale)), Image.LANCZOS)
    tok.alpha_composite(icon, ((d - icon.width) // 2, (d - icon.height) // 2))
    return tok


def name_lines(name, max_width):
    """The name at the largest size that fits in one line, or two lines for long names."""
    for size in (92, 84, 76, 70):
        f = font(size)
        if f.getlength(name) <= max_width:
            return [name], f
    words = name.split(' ')
    best = None
    for split in range(1, len(words)):
        lines = [' '.join(words[:split]), ' '.join(words[split:])]
        # Rather "Lord of / Typhon" than "Lord / of Typhon".
        capital = lines[1][:1].isupper()
        for size in (84, 76, 68, 60):
            f = font(size)
            if max(f.getlength(line) for line in lines) <= max_width:
                if best is None or (size, capital) > (best[2], best[3]):
                    best = (lines, f, size, capital)
                break
    if best:
        return best[0], best[1]
    return [name], font(52)


def wrap(text, f, max_width):
    """Greedy word wrap to max_width at font f."""
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if line and f.getlength(trial) > max_width:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def card(character, quote, base, centre):
    canvas = base.copy()
    cx, cy = centre
    d = 340 * SS
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([cx - d / 2, cy - d / 2 + 16 * SS, cx + d / 2, cy + d / 2 + 16 * SS], fill=(0, 0, 0, 150))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16 * SS)))
    tok = token(os.path.join(ROOT, character['image']), d)
    canvas.alpha_composite(tok, (int(cx - d / 2), int(cy - d / 2)))

    draw = ImageDraw.Draw(canvas)
    left, max_width = 64 * SS, 590 * SS
    lead_font = font(30)
    lines, name_font = name_lines(character['name'], max_width)
    line_h = name_font.size * 1.1
    team_label, team_colour = TEAM[character['team']]
    # The quote shrinks until the whole block fits with a margin top and bottom.
    for size in (30, 28, 26, 24, 22):
        quote_font = ImageFont.truetype(SERIF_ITALIC, size * SS)
        quote_lines = wrap(f'“{quote}”', quote_font, max_width) if quote else []
        quote_h = quote_font.size * 1.42
        block = 30 * SS * 1.35 + line_h * len(lines) + 16 * SS + 3 * SS + 22 * SS + 30 * SS * 1.25 + 26 * SS + quote_h * len(quote_lines)
        if block <= (H - 96) * SS:
            break
    y = (H * SS - block) / 2
    draw.text((left, y), "I'm the", font=lead_font, fill=DIM)
    y += 30 * SS * 1.35
    for line in lines:
        draw.text((left, y), line, font=name_font, fill=VELLUM)
        y += line_h
    y += 16 * SS
    draw.line([left, y, left + 154 * SS, y], fill=BRASS, width=3 * SS)
    y += 22 * SS
    draw.text((left, y), team_label, font=lead_font, fill=team_colour)
    y += 30 * SS * 1.25 + 26 * SS
    for line in quote_lines:
        draw.text((left, y), line, font=quote_font, fill=DIM)
        y += quote_h
    return canvas.convert('RGB').resize((W, H), Image.LANCZOS)


def main():
    with open(os.path.join(ROOT, 'data', 'characters.json'), encoding='utf8') as f:
        characters = json.load(f)
    with open(os.path.join(ROOT, 'data', 'share-quotes.json'), encoding='utf8') as f:
        quotes = {key: value['quote'] for key, value in json.load(f).items()}
    os.makedirs(OUT, exist_ok=True)
    base, centre = backdrop()
    for character in characters:
        card(character, quotes.get(character['id']), base, centre).save(
            os.path.join(OUT, character['id'] + '.jpg'), quality=84, optimize=True, progressive=True)
    print(f'Wrote {len(characters)} cards to resources/og/characters/')


if __name__ == '__main__':
    main()
