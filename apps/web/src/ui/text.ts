/**
 * 把 premise.md 这类 markdown 正文压成一段可读的纯文本摘要：剧目卡与标题画面只要「一句话讲这是什么故事」，
 * 不要 `#` 标题、`**` 强调和列表符号。正文第一行若只是把剧目名再写一遍（`# 剧名 · 前提`），整行丢掉。
 */
export function plainSummary(markdown: string, title?: string, max = 120): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0]?.startsWith("#")) {
    const heading = lines[0].replace(/^#+\s*/, "");
    if (!title || heading.includes(title) || /前提|premise|设定/i.test(heading)) lines.shift();
  }
  const text = lines
    .join(" ")
    .replace(/^#+\s*/g, "")
    .replace(/\s#+\s/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/(^|\s)[-*+]\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** 「3 分钟前 / 昨天 21:04 / 10-03」：存档与剧目卡上的相对时间。 */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = now - at;
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  const d = new Date(at);
  const today = new Date(now);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `今天 ${hhmm}`;
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`;
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return d.getFullYear() === today.getFullYear() ? `${md} ${hhmm}` : `${d.getFullYear()}-${md}`;
}
