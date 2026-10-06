import requests, sys, json, base64, os
prompt_path, aspect, size, out_path = sys.argv[1:5]
with open(prompt_path) as f: prompt = f.read()
resp = requests.post(
  "http://127.0.0.1:38000/v1beta/models/gemini-3.1-flash-image:generateContent",
  headers={"x-goog-api-key": "flow-bce69c7094", "Content-Type": "application/json"},
  json={"contents":[{"role":"user","parts":[{"text":prompt}]}],
        "generationConfig":{"responseModalities":["IMAGE"],"imageConfig":{"aspectRatio":aspect,"imageSize":size}}},
  timeout=300)
print("HTTP", resp.status_code)
try:
  j=resp.json()
except Exception as e:
  print(resp.text[:2000]); sys.exit(1)
parts=j.get("candidates",[{}])[0].get("content",{}).get("parts",[])
print("parts:",len(parts),[list(p.keys()) for p in parts])
for p in parts:
  if "inlineData" in p:
    open(out_path,"wb").write(base64.b64decode(p["inlineData"]["data"]))
    print("saved",out_path,os.path.getsize(out_path)); break
  if "fileData" in p: print(p["fileData"])
else:
  print(json.dumps(j)[:3000]); sys.exit(2)
