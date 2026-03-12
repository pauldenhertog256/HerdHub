"""
Standalone image downloader — reads breeds.json and downloads any
missing images to images/. Safe to stop and resume at any time.
"""

import json
import os
import re
import time
import requests
from urllib.parse import unquote

OUT_DIR = "images"
DATA_FILE = "breeds.json"
DELAY = 2.0  # seconds between downloads

session = requests.Session()
session.headers.update({
    "User-Agent": "CattleBreedScraper/1.0 (Educational; https://en.wikipedia.org/)",
    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    "Referer": "https://en.wikipedia.org/",
})

os.makedirs(OUT_DIR, exist_ok=True)
breeds = json.load(open(DATA_FILE, encoding="utf-8"))
existing = set(os.listdir(OUT_DIR))

candidates = [b for b in breeds if b.get("imageUrl")]
total = len(candidates)
print(f"{total} breeds have an imageUrl. {len(existing)} already downloaded.")

saved = skipped = failed = 0

for i, breed in enumerate(candidates, 1):
    url = breed["imageUrl"]
    orig_fn = unquote(url.split("/")[-1].split("?")[0])
    ext = orig_fn.rsplit(".", 1)[-1].lower() if "." in orig_fn else "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "svg", "webp", "tiff", "tif"}:
        ext = "jpg"
    safe_name = re.sub(r"[^\w\-]", "_", breed["name"])
    filename = f"{safe_name}.{ext}"
    breed["localImage"] = f"{OUT_DIR}/{filename}"

    if filename in existing:
        skipped += 1
        continue

    success = False
    for attempt in range(4):
        try:
            resp = session.get(url, timeout=30, stream=True)
            if resp.status_code == 429:
                time.sleep(15 * (attempt + 1))
                continue
            if resp.status_code == 403:
                # 403 on a thumburl is rare but can happen — skip it
                print(f"  403 – skipping {breed['name']}")
                break
            resp.raise_for_status()
            filepath = os.path.join(OUT_DIR, filename)
            with open(filepath, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=65536):
                    fh.write(chunk)
            existing.add(filename)
            saved += 1
            success = True
            break
        except requests.RequestException as e:
            if attempt < 3:
                time.sleep(5)
            else:
                print(f"  Error ({breed['name']}): {e}")

    if not success and breed["localImage"]:
        breed["localImage"] = None
        failed += 1

    if i % 10 == 0 or i == total:
        print(f"  [{i}/{total}] saved={saved+skipped} failed={failed}")

    time.sleep(DELAY)

# Save updated localImage paths back to breeds.json
with open(DATA_FILE, "w", encoding="utf-8") as f:
    json.dump(breeds, f, ensure_ascii=False, indent=2)

total_on_disk = len(os.listdir(OUT_DIR))
print(f"\nDone. {total_on_disk} images in {OUT_DIR}/  |  {failed} failed")
