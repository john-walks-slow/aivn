import { Icon } from "../ui/Icon.js";

/**
 * 工坊「设置」页：演出侧的开关。存在浏览器本地（localStorage），换设备不跟着走——
 * 它们是「这台设备上怎么看这台戏」的选择，不是剧目内容。
 *
 * 模型网关、生图后端、语音密钥这些是**服务端**配置（写回 .env、重启生效），
 * 仍然在剧目库页的「设置」里；这里只放跟眼前这场演出直接相关的两项。
 */
export function WorkshopSettings({
  voice,
  continueCard,
}: {
  voice: { on: boolean; available: boolean; onToggle: () => void };
  continueCard: { on: boolean; onToggle: () => void };
}) {
  return (
    <div className="workshop-tab-pane settings-pane">
      <section className="settings-group">
        <h3>演出</h3>

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
              这一轮没给玩家介入点、直接写完时，在舞台中央摆一张「（继续）」卡。关着（默认）就是
              演完最后一句再点一下舞台接着演——翻句与继续演是同一个动作。
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
              {!voice.available && <span className="muted small">（服务端没有语音能力）</span>}
            </b>
            <span id="voice-hint" className="muted small">
              关掉只是不再合成，文字照演。语音密钥在剧目库页「设置」里配。
            </span>
          </span>
        </label>
      </section>

      <p className="muted small settings-foot">
        <Icon name="alert" size={13} /> 开关只存在这台设备的浏览器里；模型网关、生图与语音密钥是服务端配置，
        在剧目库页右上「设置」里改（写回 .env，重启服务端生效）。
      </p>
    </div>
  );
}
