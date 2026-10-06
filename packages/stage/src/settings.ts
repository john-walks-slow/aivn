/**
 * 舞台设置：localStorage 里的布尔开关。
 *
 * 单独成模块是因为**默认值本身就是需求**——「（继续）」默认关，写反的表现是
 * 「用户从没开过却看到了卡片」，从界面上很难反推。收 storage 参数是为了能在
 * node 下直接测（web 侧没有组件测试设施）。
 *
 * 存 "1"/"0"（不用 "true"），历史上 stage-voice 就是这个约定，保持一致。
 */

/** 本轮没有停止点、直接写完时，摆一张「（继续）」卡而不是点舞台续演。默认关。 */
export const SETTING_CONTINUE_CARD = "stage-continue-card";
/** 语音合成总开关。默认开（有语音能力时才用得上）。 */
export const SETTING_VOICE = "stage-voice";

export function readFlag(storage: Pick<Storage, "getItem">, key: string, fallback: boolean): boolean {
  const raw = storage.getItem(key);
  return raw === null ? fallback : raw === "1";
}

export function writeFlag(storage: Pick<Storage, "setItem">, key: string, value: boolean): void {
  storage.setItem(key, value ? "1" : "0");
}
