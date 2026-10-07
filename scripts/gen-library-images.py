#!/usr/bin/env python3
"""用自建生图网关（Gemini 协议）生成资源库的背景图与立绘底图。

只管「出图」，落盘与抠底由 shell 侧脚本接手。出图规格按项目铁律：
- 背景 16:9（立绘 9:16），画幅写进 imageConfig，**必须传别名模型名**否则参数被静默丢弃。
- 立绘要 2D 平涂赛璐璐 + 纯白纯色底、无渐变无投影、双臂略离身体——`cutout.ts` 的全局色键
  只在这种底色上成立。
- 差分靠垫图（inlineData）保一致性：先出 neutral，再拿 neutral 当垫图出各表情。

用法：python3 scripts/gen-library-images.py <out-dir> <job> [job ...]
job 取值见下方 JOBS。已在 out-dir 存在的图会跳过，可断点重跑。
"""
import base64
import json
import os
import sys
import urllib.request

BASE = os.environ.get("IMAGE_BASE_URL", "http://127.0.0.1:38000")
KEY = os.environ["IMAGE_API_KEY"]
MODEL = "gemini-3.0-pro-image"  # 别名：只有别名才会解析 imageConfig 的画幅/尺寸

# 背景：无人场景，画面描述要能直接当 <scene bg> 的语义用
BACKGROUNDS = {
    "bg_classroom_sunset": {
        "aspect": "16:9",
        "prompt": (
            "Anime visual novel background, empty Japanese high school classroom at sunset. "
            "Rows of wooden desks facing a blackboard, warm orange sunlight pouring through "
            "the west-facing windows, long slanted light beams cutting across the floor, dust "
            "motes floating in the air. Soft painterly cel shading, no people, no text, "
            "wide establishing shot, cinematic depth of field."
        ),
    },
    "bg_school_hallway": {
        "aspect": "16:9",
        "prompt": (
            "Anime visual novel background, empty school corridor right after classes. "
            "Row of classroom doors on one side, tall windows on the other casting long "
            "afternoon light rectangles on the floor, scattered shoes at the lockers. "
            "Dusty golden haze, no people, no text, wide establishing shot, "
            "soft painterly cel shading, nostalgic quiet mood."
        ),
    },
    "bg_rooftop_dusk": {
        "aspect": "16:9",
        "prompt": (
            "Anime visual novel background, school rooftop at dusk. Chain-link fence in the "
            "foreground, distant city skyline and gradient sky shifting from amber to deep "
            "violet, first stars appearing, water tower silhouette at the edge. "
            "No people, no text, wide establishing shot, painterly cel shading, "
            "bittersweet end-of-day atmosphere."
        ),
    },
    "bg_rainy_window": {
        "aspect": "16:9",
        "prompt": (
            "Anime visual novel background, view from inside a dim bedroom at night through a "
            "rain-streaked window. Water droplets running down the glass, blurred streetlight "
            "bokeh outside, faint reflection of a desk lamp, deep blue-teal palette. "
            "No people, no text, wide establishing shot, painterly cel shading, "
            "quiet melancholy mood."
        ),
    },
    "bg_cherry_blossom_street": {
        "aspect": "16:9",
        "prompt": (
            "Anime visual novel background, a quiet residential street under blooming cherry "
            "blossom trees. Pink petals drifting through soft morning light, low guardrail "
            "along a small canal, utility poles receding into the distance. "
            "No people, no text, wide establishing shot, painterly cel shading, "
            "fresh spring warmth."
        ),
    },
}

# 立绘：先生成 neutral 底图，其余表情都以它为垫图（角色一致性的唯一可靠手段）
SPRITE_BASE = (
    "Full body anime character sheet of a single teenage girl, standing straight and facing "
    "the viewer, arms slightly away from her torso. 2D flat cel-shaded anime illustration, "
    "clean hard-edged shading, no gradients, no soft airbrush. Long dark-brown hair with a "
    "side ponytail, calm grey eyes, wearing a simple school uniform: white short-sleeve blouse "
    "under a navy cardigan, dark pleated skirt, white socks, black loafers. "
    "PLAIN SOLID PURE WHITE background, uniform white with no vignette, no shadow, "
    "no floor line, no props, no text, character fully inside the frame with margin all around."
)
SPRITE_EXPRESSIONS = {
    "smile": (
        "Change only her facial expression to a gentle closed-mouth smile with softened eyes, "
        "a little blush on the cheeks. Keep the face, hairstyle, hair color, eye color, "
        "uniform, pose, body proportions and the plain white background exactly identical."
    ),
    "worried": (
        "Change only her facial expression to a worried look: brows tilted up in the centre, "
        "eyes slightly widened, lips parted. Keep the face, hairstyle, hair color, eye color, "
        "uniform, pose, body proportions and the plain white background exactly identical."
    ),
    "surprised": (
        "Change only her facial expression to a startled look: eyes wide open, eyebrows raised, "
        "mouth forming a small open circle. Keep the face, hairstyle, hair color, eye color, "
        "uniform, pose, body proportions and the plain white background exactly identical."
    ),
}


def generate(prompt, aspect, out_path, reference=None):
    parts = [{"text": prompt}]
    if reference:
        with open(reference, "rb") as handle:
            parts.append(
                {
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": base64.b64encode(handle.read()).decode(),
                    }
                }
            )
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect, "imageSize": "2k"},
        },
    }
    req = urllib.request.Request(
        f"{BASE}/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        payload = json.loads(resp.read())
    for candidate in payload.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                with open(out_path, "wb") as handle:
                    handle.write(base64.b64decode(inline["data"]))
                return True
    raise RuntimeError(f"响应里没有图片: {json.dumps(payload)[:400]}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    out_dir = sys.argv[1]
    jobs = sys.argv[2:]
    os.makedirs(out_dir, exist_ok=True)
    for job in jobs:
        if job.startswith("bg:"):
            spec = BACKGROUNDS[job[3:]]
            path = os.path.join(out_dir, f"{job[3:]}.jpg")
        elif job == "sprite:neutral":
            spec = {"aspect": "9:16", "prompt": SPRITE_BASE}
            path = os.path.join(out_dir, "neutral.jpg")
        elif job.startswith("sprite:"):
            expr = job.split(":", 1)[1]
            # 有垫图时只说「锁住身份、只改表情」——重述整段底图反而会让模型重新设计角色
            spec = {
                "aspect": "9:16",
                "prompt": (
                    "Keep this character exactly identical - same face, same hairstyle, same "
                    "hair color, same eye color, same uniform, same pose, same body proportions, "
                    "same plain pure white background and same framing. "
                    + SPRITE_EXPRESSIONS[expr]
                ),
            }
            path = os.path.join(out_dir, f"{expr}.jpg")
        else:
            print(f"未知 job: {job}", file=sys.stderr)
            sys.exit(2)
        if os.path.exists(path) and os.path.getsize(path) > 10000:
            print(f"skip {path}（已存在）")
            continue
        reference = None
        if job.startswith("sprite:") and job != "sprite:neutral":
            reference = os.path.join(out_dir, "neutral.jpg")
        print(f"generating {path} ...", flush=True)
        generate(spec["prompt"], spec["aspect"], path, reference)
        print(f"  -> {os.path.getsize(path)} bytes", flush=True)


if __name__ == "__main__":
    main()
