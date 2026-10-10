import os
import urllib.request
import json

PROXY = "http://127.0.0.1:7890"
os.environ["http_proxy"] = PROXY
os.environ["https_proxy"] = PROXY

OUT = "docs/features/261010-ui-rehaul/refs"
os.makedirs(OUT, exist_ok=True)

GAMES = [
    ("1144400", "senren-banka"),
    ("924400", "summer-pockets"),
    ("1547890", "mahoyo"),
    ("412830", "steins-gate"),
    ("1243670", "cafe-stella"),
]

count = 1
for appid, title in GAMES:
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            screenshots = data[appid]["data"].get("screenshots", [])
            for s in screenshots[:3]:
                img_url = s["path_full"]
                fname = f"{OUT}/{count:02d}-{title}-{s['id']}.jpg"
                urllib.request.urlretrieve(img_url, fname)
                print(f"Downloaded {fname}")
                count += 1
    except Exception as e:
        print(f"Error {appid}: {e}")

print("Done downloading official Steam Galgame screenshots!")
