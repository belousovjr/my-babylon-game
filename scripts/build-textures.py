"""Prepare small CC0 city textures. Source archives stay in a local cache, not in the game."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import random
import urllib.request
import zipfile
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[1]
ASSETS = {'asphalt': 'Asphalt031', 'concrete': 'Concrete031', 'brick': 'Bricks090', 'metal': 'Metal046A', 'grass': 'Grass004'}
SIZES = (512, 128, 32)


def neutral(image, contrast=0.3):
    gray = ImageOps.grayscale(image)
    mean = ImageStat.Stat(gray).mean[0]
    return gray.point(lambda n: max(0, min(255, round(222 + (n - mean) * contrast)))).convert('RGB')


def save_set(out, name, color, ao, normal, roughness=None):
    # Bake cavity shading into lower LOD albedo: one sample instead of three.
    for lod, size in enumerate(SIZES):
        base = color if lod == 0 else ImageChops.multiply(color, ao.convert('RGB'))
        base = base.resize((size, size), Image.Resampling.LANCZOS)
        if lod == 2 and name.startswith('facade-'):
            # Retain the eight coarse floor belts when the geometric belts disappear.
            draw = ImageDraw.Draw(base)
            for y in range(3, size, 4):
                draw.line((0, y, size, y), fill=(132, 139, 139))
        base.save(out / f'{name}-{lod}.webp', quality=82, method=6)
    ao.convert('L').save(out / f'{name}-ao.webp', lossless=True, method=6)
    normal.convert('RGB').save(out / f'{name}-normal.webp', quality=90, method=6)
    # StandardMaterial replaces specularColor with map RGB, rather than multiplying it.
    strength = (61, 69, 77) if name == 'facade-glass' else (46, 46, 43) if name == 'metal' else (77, 87, 89) if name == 'water' else (6, 6, 6)
    specular = Image.new('RGBA', (256, 256), (*strength, 255))
    roughness = roughness if roughness is not None else Image.new('L', (512, 512), 60 if 'glass' in name or name == 'water' else 180)
    specular.putalpha(ImageOps.invert(roughness.convert('L')).resize((256, 256), Image.Resampling.LANCZOS))
    specular.save(out / f'{name}-specular.webp', lossless=True, method=6)


def facade(base, masonry=False):
    color = base.copy()
    ao = Image.new('L', (512, 512), 255)
    height = Image.new('L', (512, 512), 180)
    draw, shadow, relief = ImageDraw.Draw(color), ImageDraw.Draw(ao), ImageDraw.Draw(height)
    rng = random.Random(42)
    rows = 16 if masonry else 32
    step = 512 // rows
    for y in range(0, 512, step):
        for x in range(0, 512, 128 if masonry else 64):
            width = 128 if masonry else 64
            inset = 18 if masonry else 3
            box = (x + inset, y + 5, x + width - inset - 1, y + step - 4)
            shade = rng.randrange(70, 105)
            draw.rectangle(box, fill=(shade - 5, shade + 7, shade + 13))
            draw.line((box[0], box[1], box[2], box[1]), fill=(44, 52, 55), width=2)
            shadow.rectangle((box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2), fill=178)
            shadow.rectangle(box, fill=230)
            relief.rectangle(box, fill=110)
        if y % 64 == 0:
            draw.rectangle((0, y, 511, y + 2), fill=(145, 150, 147))
            shadow.rectangle((0, y, 511, y + 2), fill=194)
            relief.rectangle((0, y, 511, y + 2), fill=150)
    # A small quiet texel patch for roofs, so no extra material/submesh is needed.
    draw.rectangle((0, 0, 9, 9), fill=(220, 220, 216))
    shadow.rectangle((0, 0, 9, 9), fill=255)
    relief.rectangle((0, 0, 9, 9), fill=180)
    return color, ao, normal_from_height(height)


def normal_from_height(height):
    # Wrapped differences keep tile boundaries continuous.
    from math import sqrt
    pixels = height.load()
    normal = Image.new('RGB', height.size)
    data = []
    for y in range(height.height):
        for x in range(height.width):
            dx = (pixels[(x - 1) % height.width, y] - pixels[(x + 1) % height.width, y]) / 255
            dy = (pixels[x, (y - 1) % height.height] - pixels[x, (y + 1) % height.height]) / 255
            length = sqrt(dx * dx + dy * dy + 1)
            data.append((round(127.5 + dx / length * 127.5), round(127.5 - dy / length * 127.5), round(127.5 + 127.5 / length)))
    normal.putdata(data)
    return normal


def environment(out):
    from math import atan2, floor, sin, sqrt
    for face in ('px', 'py', 'pz', 'nx', 'ny', 'nz'):
        image = Image.new('RGB', (128, 128))
        data = []
        for y in range(128):
            for x in range(128):
                u, v = 2 * (x + 0.5) / 128 - 1, 2 * (y + 0.5) / 128 - 1
                direction = {'px': (1, -v, -u), 'nx': (-1, -v, u), 'py': (u, 1, v), 'ny': (u, -1, -v), 'pz': (u, -v, 1), 'nz': (-u, -v, -1)}[face]
                dx, dy, dz = direction
                elevation = dy / sqrt(dx * dx + dy * dy + dz * dz)
                angle = atan2(dz, dx)
                tower = floor((angle + 3.14159265) * 12)
                skyline = 0.035 + (sin(tower * 17.21) * 0.5 + 0.5) * 0.18
                if elevation < -0.05: color = (85, 95, 92)
                elif elevation < skyline: color = (100 + tower % 4 * 7, 119 + tower % 4 * 5, 125 + tower % 4 * 5)
                else:
                    t = min(1, max(0, elevation))
                    color = (round(191 - 61 * t), round(206 - 42 * t), round(207 - 20 * t))
                data.append(color)
        image.putdata(data)
        image.filter(ImageFilter.GaussianBlur(1.5)).save(out / f'environment_{face}.jpg', quality=85)


def build(cache, out):
    out.mkdir(parents=True, exist_ok=True)
    sources, prepared = [], {}
    for name, asset in ASSETS.items():
        archive = cache / f'{asset}.zip'
        url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
        if not archive.exists():
            cache.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(url, headers={'User-Agent': 'ChicagoLoopGame/0.1 (local texture preparation)'})
            with urllib.request.urlopen(request, timeout=90) as response:
                archive.write_bytes(response.read())
        raw = archive.read_bytes()
        z = zipfile.ZipFile(io.BytesIO(raw))
        def image(suffix):
            matches = [path for path in z.namelist() if path.endswith(f'_{suffix}.jpg')]
            return Image.open(io.BytesIO(z.read(matches[0]))).convert('RGB').resize((512, 512), Image.Resampling.LANCZOS) if matches else None
        color, normal, ao, height = image('Color'), image('NormalGL'), image('AmbientOcclusion'), image('Displacement')
        if color is None or normal is None or height is None:
            raise ValueError(f'Incomplete source maps: {asset}')
        if ao is None:
            # Cavity approximation from source height, not a directional shadow bake.
            cavity = ImageChops.subtract(ImageOps.grayscale(height).filter(ImageFilter.GaussianBlur(4)), ImageOps.grayscale(height))
            ao = ImageOps.invert(cavity.point(lambda n: min(70, n * 2)))
        color = neutral(color, 0.65 if name in ('grass', 'brick') else 0.4)
        if name == 'concrete':
            # Concrete031 is panelled: use it for sidewalks as well as solid structural parts.
            color = ImageEnhance.Contrast(color).enhance(0.8)
        prepared[name] = (color, ao, normal)
        save_set(out, name, color, ao, normal, image('Roughness'))
        sources.append({'id': asset, 'page': f'https://ambientcg.com/view?id={asset}', 'download': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'ao': 'source' if image('AmbientOcclusion') is not None else 'generated cavity from source height'})
    save_set(out, 'facade-stone', *facade(prepared['concrete'][0], True))
    save_set(out, 'facade-brick', *facade(prepared['brick'][0], True))
    save_set(out, 'facade-glass', *facade(Image.new('RGB', (512, 512), (202, 215, 219))))
    # Painted markings and quiet river ripples need no external photo or animation.
    rng = random.Random(7)
    for name in ('paint', 'water'):
        height = Image.new('L', (512, 512))
        height.putdata([rng.randrange(110, 146) for _ in range(512 * 512)])
        if name == 'water': height = height.resize((128, 512)).resize((512, 512)).filter(ImageFilter.GaussianBlur(2))
        color = neutral(height, 0.5)
        ao = Image.new('L', (512, 512), 255)
        if name == 'water': ao = ImageOps.grayscale(height).point(lambda n: 210 + n // 6)
        save_set(out, name, color, ao, normal_from_height(height))
    environment(out)
    manifest = {'license': 'CC0-1.0', 'sources': sources, 'derived': ['facade-stone', 'facade-brick', 'facade-glass', 'paint', 'water'], 'lodSizes': list(SIZES), 'maps': ['albedo', 'ambient occlusion', 'OpenGL normal', 'specular RGB + glossiness alpha (1 - roughness)'], 'runtime': 'LOD0 albedo+AO+normal+specular/glossiness; LOD1/2 albedo with baked AO; all levels have mipmaps'}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    sheet = Image.new('RGB', (5 * 192, 2 * 220), '#172b30')
    names = list(ASSETS) + manifest['derived']
    for i, name in enumerate(names):
        x, y = i % 5 * 192, i // 5 * 220
        sheet.paste(Image.open(out / f'{name}-0.webp').resize((192, 192)), (x, y))
        ImageDraw.Draw(sheet).text((x + 6, y + 198), name, fill='white')
    sheet.save(out / 'palette.webp', quality=85)
    print(f'{len(names)} texture families, {sum(p.stat().st_size for p in out.glob("*.webp")) / 1024:.0f} KiB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/chicago-texture-sources'))
    args = parser.parse_args()
    build(args.cache, ROOT / 'public/textures/chicago')
