import { Icon } from "@aivn/stage";
import { navigate } from "../router.jsx";

/**
 * 工坊「设置」页：演出侧的开关。存在浏览器本地（localStorage），换设备不跟着走——
 * 它们是「这台设备上怎么看这台戏」的选择，不是剧目内容。
 *
 * 模型网关、生图后端、语音密钥这些是**服务端**配置（写 <数据目录>/settings.json，保存即生效），
 * 仍然在剧目库页的「⚙ 设置」（`#/settings`）里；这一页不重复那些表单，只给出去处——
 * 一页只有两个开关，空白处与其摆说明，不如把「别的东西在哪」讲清楚。
 */
export function WorkshopSettings({
  voice,
  continueCard,
  onOpenTab,
}: {
  voice: { on: boolean; available: boolean; onToggle: () => void };
  continueCard: { on: boolean; onToggle: () => void };
  /** 「去剧目页」：切到工坊的剧目 tab（标题 / 语言 / 写作参数都在那儿）。 */
  onOpenTab: (tab: "play") => void;
}) {
  return (
    <div className="workshop-tab-pane settings-pane">
      <section className="settings-group">
        <h3>演出</h3>
        <p className="group-scope">
          仅保存在这台设备的这个浏览器里，换设备不跟着走。
        </p>

        <label className="switch-row">
          <input
            type="checkbox"
            checked={continueCard.on}
            onChange={continueCard.onToggle}
            aria-describedby="continue-card-hint"
          />
          <span>
            <b>无选项轮次间插入「继续」</b>
            <span id="continue-card-hint" className="muted small">
              关着（默认）时，演完最后一句点一下舞台接着演。
            </span>
          </span>
        </label>

        <label className="switch-row">
          <input
            type="checkbox"
            checked={voice.on}
            disabled={!voice.available}
            onChange={voice.onToggle}
            aria-describedby="voice-hint"
          />
          <span>
            <b>
              语音
              {!voice.available && (
                <span className="muted small">（服务端没有语音能力）</span>
              )}
            </b>
            <span id="voice-hint" className="muted small">
              关掉只是不再合成，文字照演。
            </span>
          </span>
        </label>
      </section>

      <section className="settings-group">
        <h3>其余设置在哪</h3>
        <p className="group-scope">
          这一页只管上面那两个开关。模型、密钥这类是整机配置，剧目字段是这一个剧目的内容，都不在这儿。
        </p>

        <div className="where-list">
          <div className="where-row">
            <div>
              <b>整机设置</b>
              <span className="muted small">
                模型网关、长会话与压缩、出图后端、语音密钥、联网检索、访问控制、界面主题。保存即生效，不用重启。
              </span>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => navigate("/settings")}
            >
              <span className="btn-icon">
                打开全局设置 <Icon name="forward" size={13} />
              </span>
            </button>
          </div>

          <div className="where-row">
            <div>
              <b>这个剧目本身</b>
              <span className="muted small">
                标题、开场指令、剧本与语音语言、无名角色音色、出图模型与画幅、封面、写作参数。
              </span>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onOpenTab("play")}
            >
              <span className="btn-icon">
                去剧目页 <Icon name="forward" size={13} />
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
