import os, sys, json, base64, urllib.request

FLOW_URL = "http://127.0.0.1:38000"
FLOW_KEY = "flow-bce69c7094"
MODEL = "gemini-3.0-pro-image"

# Read base prompt B (which had the best hairline contour)
with open("/root/projects/stage-ai/.worktrees/gal-repro/docs/gal-repro/char2/round2/p_t1_b.txt", "r") as f:
    base_prompt = f.read().strip()

# We want to replace the background line in base_prompt
# Let's inspect base_prompt first or build dynamic prompt
print("Base prompt length:", len(base_prompt))
