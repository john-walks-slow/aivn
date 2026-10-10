/**
 * 模型/网络层抛上来的原始错误串 → 用户看得懂的一句。
 *
 * `Request aborted`、`AbortError`、`fetch failed` 这些是**我们这边的机制**（超时、重启、连接断），
 * 原样贴到对话里，用户只会以为自己操作错了；而真正需要知道的「要重发一次」反而藏在原文后面。
 * 认得的几类换成人话（原文仍进服务端日志），认不出的照旧透传——那些往往是额度、密钥之类的
 * 有效信息，改写成套话反而把线索弄丢。
 */
export function userFacingError(raw: string): string {
  const text = raw.trim();
  if (text === "") return "这次请求没有完成，再发一次试试。";
  if (/abort/i.test(text)) {
    return "这次请求没有完成：等得太久或连接断了，我先把它停下了。再发一次就行。";
  }
  if (/timed?\s?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(text)) {
    return "这次请求超时了：模型没有在时限内回话。再发一次就行。";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|ECONNRESET/i.test(text)) {
    return "连不上模型网关（网络或地址不对）。到剧目库页的「设置」里核对地址与密钥。";
  }
  return text;
}

/** 换写过就返回原串，供日志留底；没换写返回 null。 */
export function rawIfRewritten(raw: string): string | null {
  return userFacingError(raw) === raw.trim() ? null : raw;
}
