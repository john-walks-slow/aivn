/**
 * 舞台生图与通用参考立绘纯函数。
 */

/**
 * 切换参考角色选中态。
 * 选中项排在前面，顺序反映用户点击的先后次序（对应提示词中的参考图编号 1st, 2nd, ...）。
 */
export function toggleReference(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) {
    return selected.filter((item) => item !== id);
  }
  return [...selected, id];
}

/**
 * 舞台生图按钮是否允许提交校验：
 * - 如果勾选了「基于历史」：指令可填可不填（不填则纯基于当前剧情）；
 * - 如果取消了「基于历史」：必须填指令（否则没有剧情也没有指令，无法出图）。
 */
export function cgCanSubmit(instruction: string, useHistory: boolean): boolean {
  if (useHistory) return true;
  return instruction.trim().length > 0;
}
