() => {
  const vw = document.documentElement.clientWidth;
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 4) continue;
    if (r.right <= vw + 1) continue;
    let p = el.parentElement, scrollable = false;
    while (p) { const ps = getComputedStyle(p); if (ps.overflowX !== 'visible') { scrollable = true; break; } p = p.parentElement; }
    if (!scrollable) clipped.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 28) + '@' + Math.round(r.x) + '+' + Math.round(r.width));
  }
  const sr = document.querySelector('.save-row');
  let save = null;
  if (sr) { const r = sr.getBoundingClientRect(); const btn = sr.querySelector('button'); const br = btn && btn.getBoundingClientRect(); save = { y: Math.round(r.y), h: Math.round(r.height), pos: getComputedStyle(sr).position, btnTxt: btn && btn.textContent.trim(), btnY: br && Math.round(br.y), btnH: br && Math.round(br.height), btnW: br && Math.round(br.width) }; }
  const cjk = [];
  for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.height > 0 && r.width > 0 && r.height / Math.max(r.width, 1) > 1.8 && /[\u4e00-\u9fff]/.test(el.textContent || '') && el.children.length === 0) cjk.push(el.tagName.toLowerCase() + '."' + (el.textContent || '').trim().slice(0, 10) + '"' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  return JSON.stringify({ sw: document.documentElement.scrollWidth, vw, clipped: clipped.slice(0, 6), bodyLen: document.body.innerText.replace(/\s/g, '').length, save, cjk: cjk.slice(0, 4) });
}
