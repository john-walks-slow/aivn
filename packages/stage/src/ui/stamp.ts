/** 墙上时刻 `09-30 04:41`：周目页的存档时间、路线卡的落笔时间共用它。 */
export function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
