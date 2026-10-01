/**
 * 模型下拉：全局设置页与剧目「Agent」页共用同一份实现与同一份数据源
 * （`GET /api/agents/models` = 网关 `/v1/models` ∩ `STAGE_MODELS`）。
 *
 * 清单读不出来时显式报错并给重试，**不退化成文本框**：下拉里摆一个发不出去的模型
 * 比整个下拉挂掉更让人误会——选之前看不出来，选完才在剧目里 400。
 */
import type { GatewayModel } from "../api.js";

export function ModelSelect(props: {
  value: string;
  models: GatewayModel[] | null;
  error: string | null;
  onChange: (id: string) => void;
  onRetry: () => void;
  /** 空值选项文案（如「跟随服务端默认」）；不传则不渲染空值选项。 */
  emptyLabel?: string;
}) {
  if (props.error) {
    return (
      <div className="row agent-model-error">
        <span className="muted small">模型清单读不出来：{props.error}</span>
        <button type="button" className="ghost-btn small-btn" onClick={props.onRetry}>
          重试
        </button>
      </div>
    );
  }
  return (
    <select
      value={props.value}
      disabled={props.models === null}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.emptyLabel !== undefined && <option value="">{props.emptyLabel}</option>}
      {(props.models ?? []).map((m) => (
        <option key={m.id} value={m.id}>
          {m.name === m.id ? m.id : `${m.name}（${m.id}）`}
        </option>
      ))}
      {/* 配置里存的模型可能不在服务端清单内（清单后来改了、或网关下架了）：
          补一项显示出来——select 的 value 找不到对应 option 会渲染成空白，看着像设置丢了 */}
      {props.value !== "" && !(props.models ?? []).some((m) => m.id === props.value) && (
        <option value={props.value}>{props.value}（不在支持清单里）</option>
      )}
    </select>
  );
}

/** `STAGE_MODELS` 为空时下拉是全网关清单，非空时只给清单里那几个——两种情况都得有个说明。 */
export function modelSourceHint(models: GatewayModel[], allowList: string): string {
  return allowList.trim() === ""
    ? `「支持的模型」为空，下拉给的是网关全部 ${models.length} 个模型`
    : `下拉只给「支持的模型」里列出的 ${models.length} 个`;
}
