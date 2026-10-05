import { Icon } from "./Icon.js";

export interface RefCandidate {
  id: string;
  name: string;
  spriteUrl: string | null;
}

/**
 * 参考立绘选择器：
 * - 缩略图 chips，支持多选；
 * - 选中项显示次序序号（①②③……），对应出图模型垫图的先后编号；
 * - 顺序按点击先后排序。
 */
export function RefCharacterPicker({
  candidates,
  selected,
  onToggle,
}: {
  candidates: RefCandidate[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="ref-picker-empty muted small">
        暂无可用立绘的角色（需先有立绘才可作为垫图参考）
      </div>
    );
  }

  // 排序：选中的按已选顺序排在前，未选的在后
  const selectedSet = new Set(selected);
  const orderedCandidates = [
    ...selected
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is RefCandidate => Boolean(c)),
    ...candidates.filter((c) => !selectedSet.has(c.id)),
  ];

  return (
    <div className="ref-picker-grid" role="group" aria-label="选择参考立绘角色">
      {orderedCandidates.map((c) => {
        const order = selected.indexOf(c.id);
        const isSelected = order !== -1;
        return (
          <button
            key={c.id}
            type="button"
            className={`ref-picker-chip ${isSelected ? "selected" : ""}`}
            onClick={() => onToggle(c.id)}
            title={isSelected ? `第 ${order + 1} 位参考图：${c.name}（点击取消）` : `添加参考：${c.name}`}
            aria-pressed={isSelected}
          >
            {c.spriteUrl ? (
              <img src={c.spriteUrl} alt={c.name} className="ref-chip-thumb" />
            ) : (
              <span className="ref-chip-blank">
                <Icon name="users" size={14} />
              </span>
            )}
            <span className="ref-chip-name">{c.name}</span>
            {isSelected && <span className="ref-chip-order">{order + 1}</span>}
          </button>
        );
      })}
    </div>
  );
}
