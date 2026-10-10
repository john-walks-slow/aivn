() => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const out = { vw, vh, pageScrollW: document.documentElement.scrollWidth, wide: [], clipped: [], offBottom: [], fixed: [] };
  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return false;
    if (st.getPropertyValue('pointer-events') === 'none' && !el.textContent.trim()) return false;
    return true;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 60);
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    const desc = `${tag}.${cls}|"${txt}"|${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`;
    if (r.right > vw + 1 && r.width > 8) {
      const st = getComputedStyle(el);
      const parentOverflowX = (() => { let p = el.parentElement; while (p) { const ps = getComputedStyle(p); if (ps.overflowX !== 'visible') return ps.overflowX; p = p.parentElement; } return 'none'; })();
      if (parentOverflowX === 'visible' && st.position !== 'sticky') out.clipped.push(desc);
    }
    if (r.bottom > vh + 1 && getComputedStyle(el).position !== 'fixed') out.offBottom.push(desc);
    if (getComputedStyle(el).position === 'fixed') out.fixed.push(desc);
  }
  const cjkNarrow = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.width > 0 && r.height / Math.max(r.width, 1) > 1.8 && /[一-龥]/.test(el.textContent || '') && el.children.length === 0) {
      cjkNarrow.push(`${el.tagName.toLowerCase()}|"${(el.textContent||'').trim().slice(0,16)}"|${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  out.clipped = out.clipped.slice(0, 25); out.offBottom = out.offBottom.slice(0, 12); out.fixed = out.fixed.slice(0, 10); out.cjkNarrow = cjkNarrow.slice(0, 10);
  return JSON.stringify(out, null, 1);
}
