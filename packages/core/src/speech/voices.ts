/**
 * 预置二次元音色库（fish-audio reference_id）——server（voiceId 校验）与 web（试听下拉）共享。
 * 全部音色经 fish-tts 合成验证可用；新增音色须先实测再入列。
 */
export interface VoicePreset {
  /** fish-audio reference_id（角色卡 voiceId 直接填此值）。 */
  id: string;
  name: string;
  /** 声线特点（UI 提示用）。 */
  tone: string;
}

export const VOICE_PRESETS: VoicePreset[] = [
  { id: "f82e3885ac22468eb6c773b96f2c5752", name: "萝莉萌妹", tone: "中文·幼态萌妹" },
  { id: "0c54c26032024142bf6339dc4d4aca1b", name: "Cute Girl", tone: "甜美灵动·轻快少女" },
  { id: "73647cd4ff7c477cb787d5fd8068f3e8", name: "アニメ声の少女", tone: "标准动漫少女音" },
  { id: "0c7771ca5910484e8a4933068017fcee", name: "Rem", tone: "温柔治愈·女仆声线" },
  { id: "abf4fa2e25634b41aadc4e0ef9ddaea5", name: "元气女仆", tone: "活泼元气" },
  { id: "c174516c799a42e7be88b96c86cfbd3e", name: "Frieren", tone: "平静空灵·知性" },
  { id: "3fd70bbcdb6342df8c0c4143b958944b", name: "Furina", tone: "戏剧感·娇俏" },
  { id: "deb7b4e20b7048b19f96b646bfaa4549", name: "ラム", tone: "傲娇姐姐" },
  { id: "4c415bf6872a4700adbda9a2d8b02fbb", name: "ツンデレ女子", tone: "傲娇系" },
  { id: "20967b3d497045b78e992924f2f05488", name: "神尾観鈴", tone: "治愈系" },
  { id: "5161d41404314212af1254556477c17d", name: "元気な女性", tone: "元气系女性" },
  { id: "0089dce5fefb4c6ba9b9f2f0debe1ddc", name: "落ち着いた女性", tone: "沉稳系女性" },
  { id: "825c9e9870494118ad93b6853a22d5e7", name: "女性ナレーション", tone: "旁白系" },
  { id: "ed3a1c523b524870a85a5a76cb1e0c3d", name: "元気な少年", tone: "元气正太" },
  { id: "efc1ce3726a64bbc947d53a1465204aa", name: "派蒙", tone: "中文·小飞毯" },
  { id: "0b8449eb752c4f888f463fc5d2c0db65", name: "可莉", tone: "中文·蹦蹦炸弹" },
];

/** voiceId 是否为已知预置音色（或形如 fish reference_id 的 32 位 hex）。 */
export function isVoiceId(id: string): boolean {
  return VOICE_PRESETS.some((v) => v.id === id) || /^[0-9a-f]{32}$/.test(id);
}
