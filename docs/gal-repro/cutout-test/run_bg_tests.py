import os, sys, json, base64, urllib.request

FLOW_URL = "http://127.0.0.1:38000"
FLOW_KEY = "flow-bce69c7094"
MODEL = os.environ.get("FLOW_MODEL", "gemini-3.0-pro-image")

# Base character prompt (excluding background line)
CHAR_DESC = """CHARACTER & AURA: Fragile petite moe girl, 5 heads tall anime child-like anatomy, flat chest, narrow frame. Round soft baby face, drooping sleepy eyes with detailed layered pink-violet irises, long delicate lashes, clueless naive expression, subtle soft blush.
COSTUME: Dark cocoa brown capelet trimmed with delicate fine white lace frills, two black pompom ties, vivid red neck bow. Layered tiered ruffled mini skirt with pale lilac accents, sheer dark pantyhose with subtle satin sheen on slender legs, classic brown vintage lace-up boots. Pale silver hair in airy twin tails, black "X" hair clip, white ribbon bow.
LINEART & RENDERING: Exquisite hairline contouring, micro-thin colored lineart seamlessly blending with shading, delicate soft-edge airbrushing with porcelain skin luminosity, intricate cloth fold physics, ultra-refined commercial visual novel sprite quality. Completely clean, crisp yet soft, no harsh black stroke, no comic outline, no text, no watermark."""

TESTS = {
    "green": {
        "color": "pure chroma green #00FF00",
        "bg_prompt": "Pristine commercial bishoujo light novel official character art, high-end galgame tachie, full body standing portrait from head to shoes. Background is one single flat solid colour #00FF00 (pure vivid chroma green) used as a chroma key, chosen to appear nowhere on the character. Flat uniform solid background with zero lighting interaction, NO green ambient light bounce on hair or skin, NO green rim light, unlit flat studio backdrop, crisp clean edges."
    },
    "magenta": {
        "color": "pure chroma magenta #FF00FF",
        "bg_prompt": "Pristine commercial bishoujo light novel official character art, high-end galgame tachie, full body standing portrait from head to shoes. Background is one single flat solid colour #FF00FF (pure vivid chroma magenta) used as a chroma key, chosen to appear nowhere on the character. Flat uniform solid background with zero lighting interaction, NO magenta ambient light bounce on hair or skin, NO magenta rim light, unlit flat studio backdrop, crisp clean edges."
    },
    "cyan": {
        "color": "pure vivid cyan #00E5FF",
        "bg_prompt": "Pristine commercial bishoujo light novel official character art, high-end galgame tachie, full body standing portrait from head to shoes. Background is one single flat solid colour #00E5FF (pure vivid electric cyan) used as a chroma key, chosen to appear nowhere on the character. Flat uniform solid background with zero lighting interaction, NO cyan ambient light bounce on hair or skin, NO cyan rim light, unlit flat studio backdrop, crisp clean edges."
    }
}

target_key = sys.argv[1]
item = TESTS[target_key]
full_prompt = f"{item['bg_prompt']}\n{CHAR_DESC}"
out_path = f"t1_{target_key}.jpg"

print(f"Generating for {target_key} -> {out_path} using {MODEL}...")

payload = {
    "contents": [{"parts": [{"text": full_prompt}]}],
    "generationConfig": {
        "imageConfig": {
            "aspectRatio": "9:16",
            "imageSize": "1k"
        }
    }
}

req = urllib.request.Request(
    f"{FLOW_URL}/v1beta/models/{MODEL}:generateContent",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "x-goog-api-key": FLOW_KEY}
)

with urllib.request.urlopen(req, timeout=180) as resp:
    data = json.loads(resp.read().decode("utf-8"))

cand = data["candidates"][0]
parts = cand["content"]["parts"]
img_data = None
for p in parts:
    if "inlineData" in p:
        img_data = base64.b64decode(p["inlineData"]["data"])
        break

if img_data:
    with open(out_path, "wb") as f:
        f.write(img_data)
    print(f"Successfully saved {out_path} ({len(img_data)} bytes)")
else:
    print("Error: no inlineData found", parts)
    sys.exit(1)
