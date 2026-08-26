import json
from pathlib import Path

from PIL import Image

ROOT = Path(r"E:\Zoho\Zoho Catalyst\baylen_app")
SRC = ROOT / "assets" / "icon" / "baylen-app-icon.png"
DEST = ROOT / "ios" / "Runner" / "Assets.xcassets" / "AppIcon.appiconset"
CONTENTS = DEST / "Contents.json"


def main() -> None:
    master = Image.open(SRC).convert("RGB")
    spec = json.loads(CONTENTS.read_text(encoding="utf-8"))
    DEST.mkdir(parents=True, exist_ok=True)
    for item in spec["images"]:
        filename = item.get("filename")
        if not filename:
            continue
        w, h = (float(part) for part in item["size"].split("x"))
        scale = int(str(item["scale"]).replace("x", ""))
        px = int(round(w * scale))
        py = int(round(h * scale))
        resized = master.resize((px, py), Image.Resampling.LANCZOS)
        resized.save(DEST / filename, "PNG")
        print(filename, px)


if __name__ == "__main__":
    main()
