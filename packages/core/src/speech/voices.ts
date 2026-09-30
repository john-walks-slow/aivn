/**
 * Fish Audio 音色库契约——server 从公共库 API 抓取，web 音色库面板消费。
 *
 * 音色列表不再硬编码：Fish 公共库（`GET {base}/model`）当前可达 1000 条热门音色，
 * 横跨 19 种语言。目录由 `apps/server/src/voiceCatalog.ts` 抓取缓存后经 `/api/voices` 下发。
 */

/** 一条音色（角色卡 voiceId 直接填 `id`，即 fish 的 reference_id）。 */
export interface VoiceEntry {
  /** fish-audio reference_id（32 位 hex），也是 play.json 的 voiceId。 */
  id: string;
  title: string;
  /** 音色描述（Fish 社区作者写的说明），UI 副标题。 */
  description: string;
  /** 支持语言（ISO 639-1）；多语言音色在每个语言筛选下都出现。 */
  languages: string[];
  /** 社区标签（male/female/narration/energetic…），UI 可展示或做二次筛选。 */
  tags: string[];
  /** 收藏数——库内默认排序键（热度）。 */
  likes: number;
  /** 封面图路径（Fish CDN 的 `coverimage/<id>` 相对路径），空串表示无图。 */
  cover: string;
}

export interface VoiceCatalog {
  entries: VoiceEntry[];
  /** 抓取时刻（epoch ms）——UI 展示新鲜度。 */
  fetchedAt: number;
  /** Fish 声明的全库总数（免费档可达窗口 1000），用于说明"仅列热门前 N"。 */
  totalAvailable: number;
  /** 本次目录是否来自磁盘快照（抓取 API 失败时沿用上次的）。 */
  stale: boolean;
}

/** ISO 639-1 → 中文显示名。语音语言下拉与音色库语言轨共用；未收录的代码原样显示。 */
export const LANGUAGE_LABELS: Record<string, string> = {
  ar: "العربية / 阿拉伯语",
  bn: "বাংলা / 孟加拉语",
  cy: "Cymraeg / 威尔士语",
  de: "Deutsch / 德语",
  el: "Ελληνικά / 希腊语",
  en: "English / 英语",
  es: "Español / 西班牙语",
  fa: "فارسی / 波斯语",
  fr: "Français / 法语",
  he: "עברית / 希伯来语",
  hi: "हिन्दी / 印地语",
  hu: "Magyar / 匈牙利语",
  id: "Bahasa Indonesia / 印尼语",
  it: "Italiano / 意大利语",
  ja: "日本語 / 日语",
  ko: "한국어 / 韩语",
  lv: "Latviešu / 拉脱维亚语",
  ms: "Bahasa Melayu / 马来语",
  nl: "Nederlands / 荷兰语",
  no: "Norsk / 挪威语",
  pl: "Polski / 波兰语",
  pt: "Português / 葡萄牙语",
  ro: "Română / 罗马尼亚语",
  ru: "Русский / 俄语",
  sv: "Svenska / 瑞典语",
  sw: "Kiswahili / 斯瓦希里语",
  ta: "தமிழ் / 泰米尔语",
  th: "ไทย / 泰语",
  tl: "Tagalog / 他加禄语",
  tr: "Türkçe / 土耳其语",
  uk: "Українська / 乌克兰语",
  ur: "اردو / 乌尔都语",
  vi: "Tiếng Việt / 越南语",
  zh: "中文",
  zu: "isiZulu / 祖鲁语",
};

/** 语言显示名（未收录代码原样返回，避免小语种在 UI 上显示成空白）。 */
export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

/** 目录按语言分组计数（降序）——音色库语言轨的数据源。 */
export function countVoicesByLanguage(entries: VoiceEntry[]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const code of entry.languages) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** voiceId 是否形如 fish reference_id（32 位 hex）。 */
export function isVoiceId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}
