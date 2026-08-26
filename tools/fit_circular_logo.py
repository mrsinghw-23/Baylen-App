from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(r"E:\Zoho\Zoho Catalyst\baylen_app")
SRC = ROOT / "assets" / "icon" / "baylen-circular-app-icon-raw.png"


def logo_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    rgb = img.convert("RGB")
    px = rgb.load()
    w, h = rgb.size
    x0, y0, x1, y1 = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(r, g, b) > 18:
                found = True
                if x < x0:
                    x0 = x
                if y < y0:
                    y0 = y
                if x > x1:
                    x1 = x
                if y > y1:
                    y1 = y
    if not found:
        raise SystemExit("no logo pixels")
    return x0, y0, x1, y1


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    x0, y0, x1, y1 = logo_bbox(img)
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0
    r = max(x1 - x0, y1 - y0) / 2.0
    r_inner = r * 0.985
    pad_ratio = 0.06
    out_size = 1024
    circle_d = int(out_size * (1 - 2 * pad_ratio))

    crop_r = r_inner * 1.02
    left = int(round(cx - crop_r))
    top = int(round(cy - crop_r))
    right = int(round(cx + crop_r))
    bottom = int(round(cy + crop_r))
    canvas = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 255))
    src_box = (max(0, left), max(0, top), min(img.width, right), min(img.height, bottom))
    dst_x = max(0, -left)
    dst_y = max(0, -top)
    canvas.paste(img.crop(src_box), (dst_x, dst_y))
    canvas = canvas.resize((circle_d, circle_d), Image.Resampling.LANCZOS)

    mask_img = Image.new("L", (circle_d, circle_d), 0)
    draw = ImageDraw.Draw(mask_img)
    draw.ellipse((1, 1, circle_d - 2, circle_d - 2), fill=255)
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(0.6))

    disc = Image.new("RGBA", (circle_d, circle_d), (0, 0, 0, 255))
    disc.paste(canvas, (0, 0))
    disc.putalpha(mask_img)

    ox = (out_size - circle_d) // 2
    oy = (out_size - circle_d) // 2
    bg = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 255))
    bg.paste(disc, (ox, oy), disc)
    flat = Image.new("RGB", (out_size, out_size), (0, 0, 0))
    flat.paste(bg.convert("RGB"), (0, 0))

    icon_dir = ROOT / "assets" / "icon"
    brand_dir = ROOT / "assets" / "branding"
    icon_dir.mkdir(parents=True, exist_ok=True)
    brand_dir.mkdir(parents=True, exist_ok=True)
    png1024 = icon_dir / "baylen-app-icon.png"
    flat.save(png1024, "PNG")
    flat.save(brand_dir / "baylen-circular-logo.png", "PNG")

    trans = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    trans.paste(disc, (ox, oy), disc)
    trans.save(icon_dir / "baylen-app-icon-transparent.png", "PNG")

    mip = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    fg = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for folder, size in mip.items():
        d = res / folder
        d.mkdir(parents=True, exist_ok=True)
        flat.resize((size, size), Image.Resampling.LANCZOS).save(d / "ic_launcher.png", "PNG")
    for folder, size in fg.items():
        d = res / folder
        d.mkdir(parents=True, exist_ok=True)
        fg_img = Image.new("RGB", (size, size), (0, 0, 0))
        inner = int(size * 0.72)
        scaled = flat.resize((inner, inner), Image.Resampling.LANCZOS)
        fg_img.paste(scaled, ((size - inner) // 2, (size - inner) // 2))
        fg_img.save(d / "ic_launcher_foreground.png", "PNG")

    print(f"saved {png1024} ({png1024.stat().st_size} bytes)")
    print(f"circle_d={circle_d} bbox=({x0},{y0})-({x1},{y1})")


if __name__ == "__main__":
    main()
