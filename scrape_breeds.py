"""
Wikipedia Cattle Breeds Scraper
Parses https://en.wikipedia.org/wiki/List_of_cattle_breeds
and writes all breeds to breeds.json, downloading full-size images
to the images/ directory.
"""

import json
import os
import re
import time
from urllib.parse import unquote
import requests
from bs4 import BeautifulSoup

WIKI_BASE = "https://en.wikipedia.org"
LIST_URL  = f"{WIKI_BASE}/wiki/List_of_cattle_breeds"

HEADERS = {
    "User-Agent": (
        "CattleBreedScraper/1.0 "
        "(Educational project; contact: user@example.com)"
    )
}


def to_full_url(thumb_url: str | None) -> str | None:
    """
    Convert a Wikimedia thumbnail URL to the original full-size image URL.

    Thumb:  https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Img.jpg/320px-Img.jpg
    Full:   https://upload.wikimedia.org/wikipedia/commons/1/1a/Img.jpg
    """
    if not thumb_url:
        return None
    m = re.match(
        r"(https://upload\.wikimedia\.org/wikipedia/[^/]+)"
        r"/thumb(/[^/]+/[^/]+/[^/]+)"
        r"/\d+px-.+$",
        thumb_url,
    )
    if m:
        return m.group(1) + m.group(2)
    return thumb_url  # already a full URL or unrecognised pattern


def get_full_image(wiki_path: str) -> str | None:
    """
    Fetch the lead full-size image URL from a breed's Wikipedia article.
    Returns the original Wikimedia Commons URL or None when unavailable.
    """
    url = f"{WIKI_BASE}{wiki_path}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except requests.RequestException:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # The lead image sits inside .infobox or .mw-parser-output figure
    for selector in [
        ".infobox img",
        ".infobox-image img",
        "figure img",
    ]:
        img = soup.select_one(selector)
        if img and img.get("src"):
            src = img["src"]
            if src.startswith("//"):
                src = "https:" + src
            return to_full_url(src)

    return None


def parse_list_page() -> list[dict]:
    """
    Parse the main list page and return a list of breed dicts.

    Wikipedia table columns (in order):
      Breed | Image | Subspecies | Country/region of origin |
      Meat  | Dairy | Draught    | Other

    Purpose columns contain the label text ("Meat", "Dairy", …)
    or an em-dash ("—") when not applicable.
    """
    resp = requests.get(LIST_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    breeds: list[dict] = []

    for table in soup.select("table.wikitable"):
        raw_headers = [
            th.get_text(strip=True)
            for th in table.select("tr:first-child th")
        ]
        headers = [h.lower() for h in raw_headers]

        if not headers:
            continue

        # Map column names to indices
        col: dict[str, int] = {}
        for i, h in enumerate(headers):
            if ("breed" in h or h == "name") and "name" not in col:
                col["name"] = i
            elif ("image" in h or "photo" in h) and "image" not in col:
                col["image"] = i
            elif "subspecies" in h and "subspecies" not in col:
                col["subspecies"] = i
            elif ("country" in h or "origin" in h or "region" in h) and "origin" not in col:
                col["origin"] = i
            elif h == "meat" and "meat" not in col:
                col["meat"] = i
            elif h == "dairy" and "dairy" not in col:
                col["dairy"] = i
            elif h == "draught" and "draught" not in col:
                col["draught"] = i
            elif h == "other" and "other" not in col:
                col["other"] = i

        if "name" not in col:
            continue  # Not a breed table

        for row in table.select("tr")[1:]:  # skip header row
            cells = row.select("td")
            if not cells:
                continue

            def cell_text(idx: int) -> str:
                if idx < len(cells):
                    return cells[idx].get_text(" ", strip=True)
                return ""

            # --- Breed name + wiki link ---
            name_cell = cells[col["name"]] if col["name"] < len(cells) else None
            if name_cell is None:
                continue

            name = name_cell.get_text(" ", strip=True)
            if not name:
                continue

            link_tag = name_cell.find("a", href=True)
            wiki_path = link_tag["href"] if link_tag else None
            # Keep only internal wiki paths, discard red links and anchors
            if wiki_path and not wiki_path.startswith("/wiki/"):
                wiki_path = None
            wiki_url = (WIKI_BASE + wiki_path) if wiki_path else None

            # --- Origin ---
            origin = cell_text(col["origin"]) if "origin" in col else None

            # --- Subspecies ---
            subspecies_raw = cell_text(col["subspecies"]) if "subspecies" in col else None
            subspecies = None if subspecies_raw in (None, "—", "") else subspecies_raw

            # --- Purpose: combine the 4 boolean columns ---
            purpose_parts: list[str] = []
            for key in ("meat", "dairy", "draught", "other"):
                if key in col:
                    val = cell_text(col[key]).strip()
                    if val and val != "—":
                        purpose_parts.append(val)
            purpose = "/".join(purpose_parts) if purpose_parts else None

            # --- Inline image → full-size URL ---
            image_url: str | None = None
            if "image" in col and col["image"] < len(cells):
                img = cells[col["image"]].find("img")
                if img and img.get("src"):
                    src = img["src"]
                    if src.startswith("//"):
                        src = "https:" + src
                    image_url = to_full_url(src)

            breeds.append(
                {
                    "name": name,
                    "origin": origin,
                    "subspecies": subspecies,
                    "purpose": purpose,
                    "imageUrl": image_url,
                    "wikiUrl": wiki_url,
                }
            )

    return breeds


def enrich_missing_images(breeds: list[dict]) -> None:
    """
    For breeds without an inline image, fetch the article page
    and try to find the lead image.  Rate-limited to be polite.
    """
    missing = [b for b in breeds if b["imageUrl"] is None and b["wikiUrl"]]
    total = len(missing)
    print(f"  Fetching images for {total} breeds without inline images …")

    for i, breed in enumerate(missing, 1):
        wiki_path = breed["wikiUrl"].replace(WIKI_BASE, "")
        breed["imageUrl"] = get_full_image(wiki_path)
        if i % 20 == 0 or i == total:
            print(f"    {i}/{total} done")
        time.sleep(0.3)  # polite crawl delay


def download_images(breeds: list[dict], out_dir: str = "images") -> None:
    """
    Download each breed's full-size image into out_dir/.

    Strategy:
    1. Batch-resolve all download URLs via the Wikimedia imageinfo API
       (50 filenames per request) — avoids per-file API overhead.
    2. URL-decode filenames so encoded characters (apostrophes etc.) work.
    3. Retry downloads with exponential back-off on 429.
    4. Skip files that already exist on disk.
    """
    os.makedirs(out_dir, exist_ok=True)
    candidates = [b for b in breeds if b.get("imageUrl")]
    total = len(candidates)
    print(f"  Resolving download URLs for {total} images via API ...")

    api_session = requests.Session()
    api_session.headers.update(HEADERS)

    dl_session = requests.Session()
    dl_session.headers.update({
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": "https://en.wikipedia.org/",
    })

    # ── Phase 1: batch API lookups ──────────────────────────────────────────
    # Map decoded filename → resolved CDN download URL
    resolved: dict[str, str] = {}

    def batch_api(filenames: list[str], api_url: str) -> None:
        """Query imageinfo for up to 50 filenames at once."""
        titles = "|".join(f"File:{fn}" for fn in filenames)
        params = {
            "action": "query",
            "titles": titles,
            "prop": "imageinfo",
            "iiprop": "url",
            "iiurlwidth": "2000",   # request 2000-px thumb URL (avoids 403)
            "format": "json",
        }
        for attempt in range(3):
            try:
                r = api_session.get(api_url, params=params, timeout=15)
                r.raise_for_status()
                pages = r.json().get("query", {}).get("pages", {})
                for page in pages.values():
                    title = page.get("title", "")
                    fn_canonical = title.removeprefix("File:")
                    info = page.get("imageinfo", [])
                    if info:
                        # thumburl = 2000px CDN link; url = original file
                        dl_url = info[0].get("thumburl") or info[0].get("url")
                        if dl_url:
                            # store under both space and underscore key forms
                            resolved[fn_canonical] = dl_url
                            resolved[fn_canonical.replace(" ", "_")] = dl_url
                return
            except requests.RequestException as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    print(f"    API batch error: {e}")

    # Separate Commons vs en.wikipedia files
    commons_files: list[str] = []
    enwiki_files: list[str] = []
    for breed in candidates:
        raw = breed["imageUrl"]
        fn = unquote(raw.split("/")[-1].split("?")[0])
        if "/wikipedia/commons/" in raw:
            commons_files.append(fn)
        else:
            enwiki_files.append(fn)

    for i in range(0, len(commons_files), 50):
        batch_api(commons_files[i:i+50], "https://commons.wikimedia.org/w/api.php")
        time.sleep(0.5)

    for i in range(0, len(enwiki_files), 50):
        batch_api(enwiki_files[i:i+50], "https://en.wikipedia.org/w/api.php")
        time.sleep(0.5)

    print(f"    Resolved {len(resolved)}/{total} URLs.")

    # Update imageUrl in breeds to the properly-resolved API URL
    for breed in candidates:
        raw = breed["imageUrl"]
        fn = unquote(raw.split("/")[-1].split("?")[0])
        api_url = resolved.get(fn) or resolved.get(fn.replace("_", " "))
        if api_url:
            breed["imageUrl"] = api_url

    # Phase 2: download
    # breed["imageUrl"] is now already the resolved thumburl from Phase 1.
    print(f"  Downloading images into {out_dir}/ ...")
    done = 0
    for i, breed in enumerate(candidates, 1):
        download_url = breed.get("imageUrl")
        if not download_url:
            breed["localImage"] = None
            continue

        # Derive a safe local filename from the breed name + extension
        orig_fn = unquote(download_url.split("/")[-1].split("?")[0])
        ext = orig_fn.rsplit(".", 1)[-1].lower() if "." in orig_fn else "jpg"
        if ext not in {"jpg", "jpeg", "png", "gif", "svg", "webp", "tiff", "tif"}:
            ext = "jpg"
        safe_name = re.sub(r"[^\w\-]", "_", breed["name"])
        filename = f"{safe_name}.{ext}"
        filepath = os.path.join(out_dir, filename)
        breed["localImage"] = f"{out_dir}/{filename}"

        if os.path.exists(filepath):
            done += 1
            continue

        # Download with retry on 403 and 429
        saved = False
        for attempt in range(6):
            try:
                resp = dl_session.get(download_url, timeout=60, stream=True)
                if resp.status_code in (403, 429):
                    # CDN rate-limit — back off and retry
                    wait = min(10 * (attempt + 1), 60)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                with open(filepath, "wb") as fh:
                    for chunk in resp.iter_content(chunk_size=65536):
                        fh.write(chunk)
                saved = True
                break
            except requests.RequestException as e:
                if attempt < 5:
                    time.sleep(5 * (attempt + 1))
                else:
                    print(f"    Failed ({breed['name']}): {e}")
                    breed["localImage"] = None

        if not saved:
            breed["localImage"] = None
        else:
            done += 1

        if i % 20 == 0 or i == total:
            print(f"    {i}/{total} ({done} saved)")
        time.sleep(4.0)  # 4-second pause — keeps us under CDN rate limits


def main() -> None:
    print("Fetching list of cattle breeds from Wikipedia ...")
    breeds = parse_list_page()
    print(f"  Found {len(breeds)} breeds in the tables.")

    print("Enriching missing images from individual articles ...")
    enrich_missing_images(breeds)

    print("Downloading full-size images ...")
    download_images(breeds)

    output_path = "breeds.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(breeds, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Saved {len(breeds)} breeds to {output_path}")

    with_image = sum(1 for b in breeds if b["imageUrl"])
    downloaded = sum(1 for b in breeds if b.get("localImage"))
    with_wiki  = sum(1 for b in breeds if b["wikiUrl"])
    print(f"  With image URL : {with_image}")
    print(f"  Downloaded     : {downloaded}")
    print(f"  With wiki link : {with_wiki}")
    print(f"  Without image  : {len(breeds) - with_image}")


if __name__ == "__main__":
    main()
