#!/usr/bin/env python3
"""
scripts/preview_server.py - Stage-AI Galgame Asset Studio Preview Server
========================================================================
Lightweight web dashboard for inspecting generated sprites, transparent PNGs,
16:9 backgrounds & Event CGs, and auditioning BGM tracks & audio loop specs.
"""

import os
import sys
import argparse
import json
import mimetypes
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse

WORKTREE_ROOT = Path(__file__).resolve().parent.parent

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stage-AI Galgame 资产工作台与画廊 (Asset Studio)</title>
  <style>
    :root {
      --primary: #e85d75;
      --primary-light: #fef0f2;
      --bg: #0f111a;
      --card-bg: #1a1d2d;
      --card-border: #2c324b;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding-bottom: 60px;
    }
    header {
      background: linear-gradient(135deg, #1e1b4b 0%, #31102f 100%);
      padding: 30px 40px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
    }
    .brand h1 {
      font-size: 24px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand .badge {
      background: var(--primary);
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 9999px;
      color: white;
    }
    .brand p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    .tabs {
      display: flex;
      gap: 10px;
      background: rgba(0,0,0,0.3);
      padding: 6px;
      border-radius: 12px;
    }
    .tab-btn {
      padding: 8px 18px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--primary);
      color: white;
    }
    main { max-width: 1300px; margin: 30px auto; padding: 0 20px; }
    .section { display: none; }
    .section.active { display: block; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    /* Sprites Section */
    .sprite-layout {
      display: grid;
      grid-template-columns: 460px 1fr;
      gap: 30px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
    }
    @media (max-width: 900px) { .sprite-layout { grid-template-columns: 1fr; } }
    .stage-viewport {
      height: 640px;
      border-radius: 12px;
      position: relative;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      border: 1px solid #334155;
    }
    .checkerboard {
      background-color: #1e293b;
      background-image: 
        linear-gradient(45deg, #0f172a 25%, transparent 25%), 
        linear-gradient(-45deg, #0f172a 25%, transparent 25%), 
        linear-gradient(45deg, transparent 75%, #0f172a 75%), 
        linear-gradient(-45deg, transparent 75%, #0f172a 75%);
      background-size: 24px 24px;
      background-position: 0 0, 0 12px, 12px -12px, -12px 0px;
    }
    .bg-dark { background: #000; }
    .bg-white { background: #fff; }
    .sprite-img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
      transition: opacity 0.15s ease-in-out;
    }
    .controls-panel h3 { font-size: 18px; margin-bottom: 12px; color: #fff; }
    .expr-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: 24px;
    }
    .expr-btn {
      background: #252b43;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px;
      color: var(--text);
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      transition: all 0.2s;
    }
    .expr-btn:hover { background: #323b5c; }
    .expr-btn.active {
      border-color: var(--primary);
      background: rgba(232, 93, 117, 0.15);
      color: #fff;
    }
    .expr-btn strong { display: block; font-size: 14px; margin-bottom: 2px; }

    /* Gallery Grid */
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      transition: transform 0.2s;
    }
    .card:hover { transform: translateY(-4px); }
    .card-thumb {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      display: block;
      background: #111;
    }
    .card-body { padding: 16px; }
    .card-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 6px; }
    .card-meta { font-size: 12px; color: var(--accent); margin-bottom: 8px; }
    .card-desc { font-size: 13px; color: var(--text-muted); }

    /* Audio Cards */
    .audio-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .audio-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .audio-title { font-size: 16px; font-weight: bold; color: #fff; }
    .audio-meta { font-size: 13px; color: var(--accent); }
    .code-box {
      background: #111422;
      border: 1px solid #23283e;
      border-radius: 8px;
      padding: 10px 14px;
      font-family: monospace;
      font-size: 12px;
      color: #93c5fd;
      margin-top: 10px;
      white-space: pre-wrap;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>Stage-AI 资产工坊 <span class="badge">Pipeline Studio</span></h1>
      <p>面向 AI Galgame 引擎的高一致性立绘、16:9 场景 CG 与无缝循环 BGM 工作流</p>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('sprites')">🎭 多表情立绘</button>
      <button class="tab-btn" onclick="switchTab('cg')">🖼️ 场景与CG画廊</button>
      <button class="tab-btn" onclick="switchTab('audio')">🎵 BGM 配乐体系</button>
      <button class="tab-btn" onclick="switchTab('cli')">⚙️ 命令行手册</button>
    </div>
  </header>

  <main>
    <!-- Section 1: Sprites -->
    <section id="sec-sprites" class="section active">
      <div class="sprite-layout">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; color:var(--text-muted);">舞台底色切换：</span>
            <div>
              <button onclick="setBg('checkerboard')" style="padding:2px 8px; font-size:12px; cursor:pointer;">棋盘透明底</button>
              <button onclick="setBg('bg-dark')" style="padding:2px 8px; font-size:12px; cursor:pointer;">纯黑(测暗部白边)</button>
              <button onclick="setBg('bg-white')" style="padding:2px 8px; font-size:12px; cursor:pointer;">纯白</button>
            </div>
          </div>
          <div id="viewport" class="stage-viewport checkerboard">
            <img id="main-sprite" class="sprite-img" src="/assets/sprites/koharu/normal.png" alt="Sprite">
          </div>
        </div>
        <div class="controls-panel">
          <h3>角色：小春 (Koharu) · 7 种经典表情切换</h3>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
            规格：1080x1920 (9:16 标准半身/全身立绘) · 锚点 [0.5, 1.0] · RGBA 32位透明通道 · 边缘去杂色去白边处理
          </p>
          <div class="expr-grid">
            <button class="expr-btn active" onclick="setExpr('normal', '平静 / 自然', 'normal.png')">
              <strong>😐 普通 / 平静</strong>
              <span>normal.png</span>
            </button>
            <button class="expr-btn" onclick="setExpr('smile', '灿烂微笑', 'smile.png')">
              <strong>😊 微笑 / 欢快</strong>
              <span>smile.png</span>
            </button>
            <button class="expr-btn" onclick="setExpr('shy', '害羞脸红', 'shy.png')">
              <strong>😳 害羞 / 脸红</strong>
              <span>shy.png</span>
            </button>
            <button class="expr-btn" onclick="setExpr('angry', '傲娇生气', 'angry.png')">
              <strong>😠 傲娇 / 生气</strong>
              <span>angry.png</span>
            </button>
            <button class="expr-btn" onclick="setExpr('sad', '悲伤眼泪', 'sad.png')">
              <strong>😢 悲伤 / 泪目</strong>
              <span>sad.png</span>
            </button>
            <button class="expr-btn" onclick="setExpr('surprised', '吃惊瞪大眼', 'surprised.png')">
              <strong>😲 吃惊 / 惊讶</strong>
              <span>surprised.png</span>
            </button>
            <button class="expr-btn" onclick="setExpr('thinking', '闭眼沉思', 'thinking.png')">
              <strong>😌 闭眼 / 沉思</strong>
              <span>thinking.png</span>
            </button>
          </div>

          <div style="background:#111422; border:1px solid #23283e; border-radius:10px; padding:16px;">
            <h4 style="font-size:14px; color:#fff; margin-bottom:8px;">当前表情详细信息与生图范式</h4>
            <div id="expr-info" style="font-size:13px; color:#94a3b8;">
              <p><strong>文件：</strong> assets/sprites/koharu/normal.png</p>
              <p><strong>范式：</strong> Sheet 切片自动抠图 (Paradigm A) / 垫图参考迭代 (Paradigm B)</p>
              <p><strong>特征锁死：</strong> 粉色长发、白双丝带、祖母绿眼眸、水手服校服、锚点对齐无跳跃</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2: CG & Backgrounds -->
    <section id="sec-cg" class="section">
      <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
        <h2 style="font-size:20px; color:#fff;">10 种经典 Galgame 场景背景与事件 CG</h2>
        <span style="font-size:13px; color:var(--accent);">标准 16:9 画幅 (1920x1080) · 新海诚/京阿尼电影级光影</span>
      </div>
      <div class="gallery-grid" id="gallery-container">
        <!-- Dynamic injected via JS -->
      </div>
    </section>

    <!-- Section 3: Audio -->
    <section id="sec-audio" class="section">
      <div style="margin-bottom:20px;">
        <h2 style="font-size:20px; color:#fff;">Galgame 6 大类配乐体系与无缝循环工程</h2>
        <p style="font-size:14px; color:var(--text-muted);">
          响度规范：-16.0 LUFS (-1.5 dB TP) · 采样率：44.1kHz 16-bit · 尾音 Crossfade 无缝接缝
        </p>
      </div>
      <div id="audio-container">
        <!-- Dynamic injected via JS -->
      </div>
    </section>

    <!-- Section 4: CLI -->
    <section id="sec-cli" class="section">
      <div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:24px;">
        <h2 style="font-size:20px; color:#fff; margin-bottom:16px;">⚙️ Pipeline 核心 CLI 工具速查</h2>
        
        <h3 style="font-size:15px; color:var(--accent); margin:16px 0 8px;">1. 多表情立绘生成器 (scripts/gen_sprite.py)</h3>
        <div class="code-box"># 范式 A：单图 2x3 网格 Sheet 裁切法 (一键生成 6+1 表情透明 PNG)
./scripts/gen_sprite.py --character koharu --mode sheet

# 范式 B：首图基底 + 垫图参考迭代法 (锁定特征，单张精修变脸)
./scripts/gen_sprite.py --character koharu --mode iterative --expressions "normal,smile,shy,angry,sad,surprised,thinking"</div>

        <h3 style="font-size:15px; color:var(--accent); margin:20px 0 8px;">2. 纯白底/绿底自适应抠图与去杂色工具 (scripts/make_transparent.py)</h3>
        <div class="code-box"># 单图自适应边缘羽化与 Despill 白边去除
./scripts/make_transparent.py input_sprite.jpg -o output.png --tolerance 35.0 --feather 22.0 --despill 1.0 --trim

# 批量转换并对齐到 1080x1920 底部居中标准画布
./scripts/make_transparent.py assets/raw_sprites/ -o assets/sprites/ --target-canvas 1080x1920</div>

        <h3 style="font-size:15px; color:var(--accent); margin:20px 0 8px;">3. 场景与事件 CG 生成器 (scripts/gen_cg.py)</h3>
        <div class="code-box"># 查看 10 大经典场景清单
./scripts/gen_cg.py --list

# 生成指定黄昏教室背景 (16:9 FHD, 新海诚光影)
./scripts/gen_cg.py --id bg_classroom_sunset --style shinkai

# 生成天台告白决定性瞬间事件 CG
./scripts/gen_cg.py --id cg_rooftop_confession --style shinkai</div>

        <h3 style="font-size:15px; color:var(--accent); margin:20px 0 8px;">4. BGM 响度归一化与无缝循环制作器 (scripts/audio_loop_helper.py)</h3>
        <div class="code-box"># 尾音 Crossfade 无缝循环处理 + -16 LUFS 响度标准化
./scripts/audio_loop_helper.py loop raw_track.mp3 -o bgm_loop.ogg --crossfade 3.0 --lufs -16.0

# 纯音乐演示音轨快速合成
./scripts/audio_loop_helper.py demo -o test_track.ogg --type warm_daily</div>
      </div>
    </section>
  </main>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('sec-' + name).classList.add('active');
    }

    function setBg(cls) {
      const vp = document.getElementById('viewport');
      vp.className = 'stage-viewport ' + cls;
    }

    function setExpr(key, label, filename) {
      document.querySelectorAll('.expr-btn').forEach(b => b.classList.remove('active'));
      event.currentTarget.classList.add('active');
      const img = document.getElementById('main-sprite');
      img.style.opacity = '0.3';
      img.src = '/assets/sprites/koharu/' + filename;
      img.onload = () => { img.style.opacity = '1.0'; };
      document.getElementById('expr-info').innerHTML = `
        <p><strong>文件：</strong> assets/sprites/koharu/${filename}</p>
        <p><strong>表情定位：</strong> ${label}</p>
        <p><strong>透明通道状态：</strong> RGBA 32-bit (已消除杂色边缘与白边)</p>
      `;
    }

    // Load Scene Presets
    fetch('/assets/scene_presets.json')
      .then(r => r.json())
      .then(data => {
        const container = document.getElementById('gallery-container');
        for (const [id, p] of Object.entries(data.presets)) {
          const isBg = p.type === 'bg';
          const folder = isBg ? 'backgrounds' : 'cg';
          const imgUrl = `/assets/${folder}/${id}.jpg`;
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `
            <img class="card-thumb" src="${imgUrl}" onerror="this.src='https://via.placeholder.com/640x360/1a1d2d/94a3b8?text=${id}'" alt="${p.title}">
            <div class="card-body">
              <div class="card-meta">${isBg ? '🏛️ 场景背景 (Scene BG)' : '💖 剧情事件 (Event CG)'} · 16:9 FHD</div>
              <div class="card-title">${p.title}</div>
              <div class="card-desc">${p.description}</div>
              <div class="code-box" style="margin-top:8px;">${p.prompt.substring(0, 140)}...</div>
            </div>
          `;
          container.appendChild(card);
        }
      });

    // Load Audio Spec
    fetch('/assets/audio/bgm_spec.json')
      .then(r => r.json())
      .then(data => {
        const container = document.getElementById('audio-container');
        data.categories.forEach(cat => {
          const card = document.createElement('div');
          card.className = 'audio-card';
          let audioPlayer = '';
          if (cat.id === 'bgm_warm_daily') {
            audioPlayer = '<audio controls style="width:100%; margin-top:10px;" src="/assets/audio/tracks/bgm_warm_daily_seamless.ogg"></audio>';
          } else if (cat.id === 'bgm_cheerful') {
            audioPlayer = '<audio controls style="width:100%; margin-top:10px;" src="/assets/audio/tracks/bgm_cheerful_school.ogg"></audio>';
          } else if (cat.id === 'bgm_sad_melancholy') {
            audioPlayer = '<audio controls style="width:100%; margin-top:10px;" src="/assets/audio/tracks/bgm_sad_melancholy.ogg"></audio>';
          }
          card.innerHTML = `
            <div class="audio-header">
              <div class="audio-title">${cat.name_zh} (${cat.name_en})</div>
              <div class="audio-meta">节奏: ${cat.tempo_bpm} BPM | 调性: ${cat.typical_key}</div>
            </div>
            <div style="font-size:13px; color:var(--text-muted); margin-bottom:8px;">
              <strong>典型场景：</strong> ${cat.scenes.join(' / ')}<br>
              <strong>主要乐器：</strong> ${cat.instrumentation.join(', ')}
            </div>
            ${audioPlayer}
            <div class="code-box"><strong>Suno 提示词:</strong> ${cat.suno_prompt_template.style_tags}
<strong>乐器编成:</strong> ${cat.suno_prompt_template.instrument_tags}
<strong>结构引导:</strong> ${cat.suno_prompt_template.structure}</div>
          `;
          container.appendChild(card);
        });
      });
  </script>
</body>
</html>
"""


class AssetStudioHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Resolve clean paths
        parsed = urllib.parse.urlparse(path)
        clean_path = parsed.path.lstrip("/")
        return str(WORKTREE_ROOT / clean_path)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_TEMPLATE.encode("utf-8"))
            return

        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description="Stage-AI Asset Studio Web Preview Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--host", default="0.0.0.0", help="Host interface to bind")
    args = parser.parse_args()

    server_address = (args.host, args.port)
    httpd = HTTPServer(server_address, AssetStudioHandler)
    print(f"Stage-AI Galgame Asset Studio preview server running at http://127.0.0.1:{args.port}/")
    print(f"Serving assets from: {WORKTREE_ROOT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down preview server.")
        httpd.server_close()


if __name__ == "__main__":
    main()
