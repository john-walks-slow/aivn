import type { SequencedEvent, StageEvent } from "../dsl/events.js";

/**
 * 停止点类型（模型能写的白名单，由 `beat_done` 工具参数承载）。
 *
 * 只有两种玩家主权点：选肢（choice）/ 自由表态（free）。
 * 「什么都不做就继续」曾经是第三种（pause），已删除：模型爱用它收尾，收出来的是
 * 「一切圆满落幕…」这类旁白加一个不知何时出现的「继续」按钮。没有停止点的收尾走
 * beat_end 的 no_stop 分支，客户端呈现为一个普通的「继续」。
 * 编排器自己造的 pause 重试入口不在这个白名单里，只住在 {@link StopPayload}。
 */
export const STOP_TYPES = ["choice", "free"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** 一个选肢：玩家面板上的一行。 */
export interface StopOption {
  text: string;
  value?: string;
}

/** 停止点载荷（编排器随 beat_end 下发，前端渲染选项/输入框）。 */
export interface StopPayload {
  /**
   * choice/free 来自模型（beat_done 的参数）；pause 只由编排器自己造——
   * 轮中分岔被截断、或空轮报错时给玩家一个重试入口，模型写不出来，
   * 无停止点的收尾（no_stop）也不会走到这里，它只有一个「继续」。
   */
  stopType: StopType | "pause";
  options?: StopOption[];
  placeholder?: string;
}

export interface BeatEndPayload {
  beatId: string;
  /** stop = 交互停止点；no_stop = 本轮自然写完（beat_done 不带选项收束），只有一个「继续」出口。 */
  reason: "stop" | "no_stop";
  stop?: StopPayload;
}

/** 待注入队列里的一句（右上角排队面板的行）。 */
export interface PromptQueueItem {
  id: string;
  text: string;
  /** 入队时的轮号：面板上写「排进第 7 轮」。 */
  beatNo: number;
  /** pending = 还没落笔，可改可删；sent = 已并入某一轮，等下一轮开始后淡出。 */
  status: "pending" | "sent";
  /** sent 时的落笔轮号。 */
  sentBeatNo?: number;
}

/** 一件正在生成的东西（右上角 pending 面板的一行）。 */
export interface PendingJob {
  id: string;
  kind: "beat" | "bg" | "cg" | "sprite" | "voice";
  /** 面板上那一行的话：「第 8 轮」「背景 rooftop」「立绘 小夜/smile」「第 3 句台词」。 */
  label: string;
  /** 生图类的实际提示词（含自动追加的画风/画布后缀）：点开看模型到底被喂了什么。 */
  prompt?: string;
  /** 入列时刻（毫秒）：面板上算「已经等了 40 秒」。 */
  startedAt: number;
  /**
   * running = 还在跑；done = 已经收尾，面板上再留一会儿才消失；failed = 挂了。
   * 收尾即删的话那一行只能凭空蒸发，玩家看不见「它刚才完成了」。
   * 失败态与 done 反着来：**不自动消失**，不亲手删就一直挂在面板上——失败了还悄悄
   * 蒸发的话，那行既没让人看出出了事，也留不下可以回看的错因。
   */
  state: "running" | "done" | "failed";
  /** 失败态的原因（后端报错原文）。面板上展开这一行看的就是它。 */
  error?: string;
}

/** 工坊线程（D9 meta-chat 多会话）在协议层的投影。 */
export interface WorkshopThreadInfo {
  id: string;
  title: string;
  updatedAt: number;
  archived: boolean;
  summary: string | null;
}

/** 工坊生成或导入的一张剧目素材（对话流内联展示）。 */
export interface WorkshopAssetView {
  /** background/cg/sprite = 图片气泡；bgm/sfx = 音频播放器（资源库导入的音素材）。 */
  kind: "background" | "cg" | "sprite" | "bgm" | "sfx";
  /** 剧目内相对路径（assets/backgrounds/rooftop.jpg），素材页与文件树里同一个东西。 */
  path: string;
  /** 站内 URL：/plays/<playId>/assets/backgrounds/rooftop.jpg。 */
  url: string;
}

/** 工坊里一次工具调用在对话流中的落点。 */
export interface WorkshopToolPart {
  type: "tool";
  /** pi 的 toolCallId：start/end 配对、素材归属都靠它。 */
  id: string;
  name: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  /** 本次调用耗时（毫秒）。 */
  ms?: number;
  /** 这次调用产出的素材，就地挂在行上（不再另开一条预览带）。 */
  assets?: WorkshopAssetView[];
}

/**
 * 一轮回复按发生顺序记成的一串段落，是渲染的唯一真相源。
 * 拼装规则见 workshopParts.ts（服务端与前端共用同一份，不各写一遍）。
 */
export type WorkshopPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | WorkshopToolPart;

/** 工坊对话消息（面板回放用）。 */
export interface WorkshopChatMessage {
  role: "user" | "assistant";
  /** 回灌 agent 上下文的唯一内容，也是旧线程文件里唯一有的东西。 */
  text: string;
  at: number;
  /**
   * 本轮的段落流（思考 / 文本 / 工具调用）。旧消息没有这个字段，
   * 渲染前用 normalizeParts() 归一成 `[{ type: "text", text }]`。
   */
  parts?: WorkshopPart[];
  /** 本条附带的素材图：不带工具调用号的素材走这里，翻历史仍看得见。 */
  images?: WorkshopAssetView[];
}

/** 工坊线程的压缩记录（面板在对话流里画一条分隔用）。 */
export interface WorkshopCompactionView {
  /** 前 cutAt 条消息已压成摘要（仍在 messages 里，只是不再进 agent 上下文）。 */
  cutAt: number;
  /** 最近一次的一句话摘要。 */
  oneLiner: string;
  /** 摘要正文（点开分隔看全文）。 */
  body: string;
}

/** 生成资产（D6 生图管线）：剧作家 preload_asset 预发射、后台生成后落 media-cache。 */
export interface GeneratedAsset {
  /** 剧作家给的资源 id，与 `<cg id>` / `<scene bg>` 同一命名空间。 */
  id: string;
  /** 站内 URL：/plays/<playId>/media/img/<file>。 */
  url: string;
  /**
   * bg | cg | sprite。立绘到货也走这条：客户端据此重拉素材声明与素材列表，
   * 刚出的差分与刚写的取景声明当场生效（id 用 `<立绘>:<差分>`，与预发射骨架同一个）。
   */
  type: "bg" | "cg" | "sprite";
}

/** 玩家读到哪儿：正在显示的台词节点 ID 与字数偏移（0 为刚开始本句）。基于稳定 nodeId 寻址，跨 rebase 与刷新保真。 */
export interface ReadPos {
  /** 正在阅读的行级台词/叙述/心声节点 ID（LineageNode.id） */
  nodeId: string;
  /** 当前行已打字显示的字符数（0 表示刚开始播放本行） */
  offset: number;
  /** 兼容老档或旧通信的序号（可选） */
  seq?: number;
  /** 兼容老档的字数（可选） */
  len?: number;
}

export type ServerMessage =
  | {
      type: "hello";
      sessionId: string;
      lastSeq: number;
      /** 这棵树还没开演过：客户端据此摆「开演」按钮，而不是一片空场。 */
      fresh?: boolean;
      cast?: { id: string; name: string }[];
      /** 服务端 TTS 能力（配置了 fish-audio keys 才为 true；false 时客户端隐藏语音开关）。 */
      voice?: boolean;
      /** 本剧目已生成的资产全集（manifest 快照）：重连即恢复可见，不必等下一次预发射。 */
      assets?: GeneratedAsset[];
      /** 此刻正在生成的事（面板起点，之后由 pending_jobs 增量整表替换）。 */
      pendingJobs?: PendingJob[];
      /**
       * 一次预发射真正可能花多久（毫秒）：客户端只拿它当「通知永远不来」的兜底上界。
       * 由服务端的生图超时与队列容量算出——客户端自己猜的数字必然与生图配置脱节
       * （曾经写死 45s，而生图 150s 才超时，骨架从来活不到图到货那一刻）。
       */
      assetsTtlMs?: number;
      /**
       * 事件缓冲代号（P6）：每次结构性操作（分岔/跳转/编辑/重写）重放缓冲并自增。
       * 客户端重连时发现与本地不一致 → 清空本地缓冲、lastSeq 归零后全量重放。
       */
      epoch?: number;
      /** 连上这一刻编排器就是空闲的（没有在跑的轮）。重连/刷新后客户端据此直接放开操作条，
       *  不用等一场本来不会到来的 beat_settled。 */
      idle?: boolean;
      /** 当前挂着的存档（周目）id：换档后客户端据此认出新现场。 */
      saveId?: string;
      /** 当前存档的档名（舞台顶部显示；改名经 announce 续接）。 */
      saveName?: string;
      /** 上次退出时读到的位置：老档没有这个字段，客户端退回「快进到本轮末尾」的老行为。 */
      readPos?: ReadPos;
      /** 此刻是否处在限制级（NSFW）剧情通道：舞台那枚常驻标识的起点，之后由 `nsfw` 消息更新。 */
      nsfw?: boolean;
    }
  | { type: "beat_start"; beatId: string }
  | { type: "events"; events: SequencedEvent[] }
  | BeatEndPayload & { type: "beat_end" }
  /** 编排器真正空闲（模型那一轮收尾完毕）：此前 beat_end 已到但导演/玩家操作仍可能被拒。 */
  | { type: "beat_settled" }
  /** 语音预取就绪（D5）：seq = 所属 say 行 say_start 事件的序号，客户端据此关联行。 */
  | { type: "audio_ready"; seq: number; phrase: number; url: string }
  /**
   * 语音已开始合成（D5）：短语进了队列、音频还没生成。
   * 没有它，合成期间那一行连喇叭图标都不显示——「正在生成」和「这句没配音」看起来一模一样。
   */
  | { type: "audio_pending"; seq: number; phrase: number }
  /** 生成就绪（D6）：客户端预解码后就地 crossfade 淡入，台词早已先行。瞬态消息不进事件缓冲。 */
  | { type: "asset_ready"; asset: GeneratedAsset }
  /** 生图失败（非慢）：客户端保持降级视觉（既有素材/氛围色），不弹占位。 */
  | { type: "asset_failed"; id: string; message: string }
  | { type: "lineage"; leafId: string; turn: number }
  /**
   * 上下文重建完成（P6 五动词共用出口）：挂载点已移到新分支，events 是该分支的完整重放。
   * 客户端收到即清空本地脚本/播放游标，按 events 重建（epoch 自增用于丢弃过期的 seq 认知）。
   */
  | {
      type: "rebase";
      epoch: number;
      leafId: string | null;
      events: SequencedEvent[];
      /** 重建后的停止点（无 = 本轮写完/轮中，客户端按 continue 处理）。 */
      stop?: StopPayload;
      reason?: "stop" | "no_stop";
      /**
       * 重建之后紧接着会开新的一轮（「重演这一轮」）。
       * 不带这个标记时重建就是终局，客户端可以直接快进到新分支末尾；带了它就必须
       * 先把旧台词收起来进入等待态——否则 stage 看到「已演完」就摆出可点击播放的
       * 终局界面，而新的一轮其实一秒后才到。
       */
      resuming?: boolean;
      /** 本次操作的人类可读说明（前端提示条）。 */
      note?: string;
      /** 跳转带来的播放头预期：start=从头播放本轮，end=直接落到末尾展现选项。 */
      playFrom?: "start" | "end";
      /** playFrom 配套的播放头落点（start 时为该轮首句，offset=0）。 */
      resumeAt?: ReadPos;
      /**
       * 这次重建不要切回舞台：删除是「在路线里整理分支」的动作，树上少一张卡就是反馈，
       * 把玩家拽回舞台等于打断他正在做的事。
       */
      keepView?: boolean;
    }
  /** 一行台词/旁白被原地改写：客户端按 seq 就地替换该行文字，不重放全量事件。 */
  | { type: "line_edited"; nodeId: string; text: string; seq?: number }
  /**
   * 限制级通道的开关（只在翻转时发，不进事件缓冲）：进段请求一发出就算「在通道里」，
   * 段末摘要落地才算退出。接上之前的值以 hello.nsfw 为准。
   */
  | { type: "nsfw"; active: boolean }
  /** 一张插图挂上了某一行（回看中生图，旁注）：客户端刷新谱系，翻到那一行就有图。 */
  | { type: "cg_attached"; nodeId: string; id: string }
  /** 待注入队列的全量快照（右上角排队面板）：落笔的会留在面板里等这一轮收束。 */
  | { type: "prompt_queue"; items: PromptQueueItem[] }
  /**
   * 在生成的全量快照（同一块面板的另一半）：剧作家正在写的那一轮、排队/在跑的生图与语音合成。
   * 瞬态消息（与 prompt_queue 一样不进事件缓冲），重连时随 hello 后的第一条补发。
   */
  | { type: "pending_jobs"; jobs: PendingJob[] }
  // —— 工坊（D9）：与演出并行的一条独立 agent 通道，消息都带 threadId 以便前端分流 ——
  | { type: "workshop_threads"; threads: WorkshopThreadInfo[]; activeId: string | null }
  | {
      type: "workshop_history";
      threadId: string;
      messages: WorkshopChatMessage[];
      /** 早期对话已压缩（未压缩为 null）：cutAt 条之前的内容已不进 agent 上下文，原文仍在 messages 里。 */
      compaction: WorkshopCompactionView | null;
    }
  /** 工坊流式增量：正文。 */
  | { type: "workshop_chunk"; threadId: string; delta: string }
  /** 工坊流式增量：思考（模型开了思考档位才有）。 */
  | { type: "workshop_thinking"; threadId: string; delta: string }
  /** 工坊 agent 开始一次工具调用。 */
  | { type: "workshop_tool_start"; threadId: string; id: string; name: string; args: unknown }
  /** 工坊 agent 结束一次工具调用（按 toolCallId 配到上面那次）。 */
  | {
      type: "workshop_tool_end";
      threadId: string;
      id: string;
      result: string;
      isError: boolean;
      ms: number;
    }
  /** 工坊 agent 写了剧目文件：before 为 null 表示新建，可据此一键撤销。 */
  | { type: "workshop_write"; threadId: string; path: string; before: string | null }
  /** 工坊出一张素材到货：带 toolCallId 的挂到那次调用的行上，不带的走消息级预览。 */
  | {
      type: "workshop_asset";
      threadId: string;
      toolCallId?: string;
      kind: WorkshopAssetView["kind"];
      path: string;
      url: string;
      replaced: boolean;
    }
  | { type: "workshop_done"; threadId: string; text: string; parts: WorkshopPart[]; images?: WorkshopAssetView[] }
  | {
      type: "workshop_error";
      threadId: string | null;
      message: string;
      parts: WorkshopPart[];
      images?: WorkshopAssetView[];
    }
  /** 手动生图完成/失败（工坊面板）：target 为目标素材 key，按 play 广播给对话框收口。 */
  | {
      type: "image_result";
      target: string;
      ok: true;
      url: string;
      path: string;
    }
  | {
      type: "image_result";
      target: string;
      ok: false;
      message: string;
    }
  | { type: "error"; message: string; recoverable: boolean };

export type ClientMessage =
  | { type: "resume"; lastSeq: number }
  /** 开演：空树的第一轮由玩家在舞台上按「开演」起，连接建立时不再自动开局。 */
  | { type: "start" }
  | { type: "player_choice"; optionIndex: number }
  | { type: "player_free"; text: string }
  | { type: "continue" }
  /** 插一句：唯一输入通道。空闲时开新轮；演出中排进待注入队列（可改可删，当轮收束后自动兑现）。 */
  | { type: "prompt"; text: string }
  /** 改队列里还没落笔的一句。 */
  | { type: "prompt_edit"; id: string; text: string }
  /** 撤掉队列里还没落笔的一句。 */
  | { type: "prompt_delete"; id: string }
  /** 从 pending 面板上手动清掉一条失败项（失败项不会自动消失，只能这样收摊）。 */
  | { type: "pending_dismiss"; jobId: string }
  /** 语音控制（D5 背压）：enabled=总开关（关=停合成）；paused=暂停预取（快进态/缓冲积压）。 */
  | { type: "tts_control"; enabled?: boolean; paused?: boolean }
  /** 分岔：世界线挂到锚点并落一条 fork 标记，其后内容整段转兄弟分支。
   *  正在演的那轮腰斩克隆：被掐断的那轮停在它演到的位置，不写 beat_end/快照。
   *  锚点二选一：`nodeId`（路线视图/回顾给的节点）或 `seq`（舞台上正在看的那一行，
   *  行要等收尾才落树，所以由服务端按「不大于该 seq 的最后一个节点」解析，见 nodeIdAtSeq）。
   *  resume=true = 「重演这一轮」：分岔后立刻续演，中间不设停止点。
   *  replaced = 被这一岔顶掉的那一拍的首节点（路线卡片知道自己是哪一张，直接点名）。
   *  新的 fork 标记继承它的来源标签，玩家回到同一锚点重选同一个动作时才认得出这条枝。
   *  instruction = 随这一岔一起交代的一句：它是新枝这一轮的第一条输入（与「插一句」
   *  同一条入账路径、同一个 prompt 节点），不是排进待注入队列等下一轮。分岔不 resume
   *  时带上它 = 新分支开出来后立刻照这句开演。 */
  | {
      type: "fork";
      nodeId?: string;
      seq?: number;
      resume?: boolean;
      replaced?: string;
      instruction?: string;
    }
  /** 删除：剪掉 nodeId 及其全部后代（路线卡片传该段首节点）。
   *  删完世界线重挂到第一个活着的祖先；只落 session.json，lineage.jsonl 是只增审计流。 */
  | { type: "delete_branch"; nodeId: string }
  | { type: "edit"; nodeId: string; newText: string }
  /** 导演生图：按当前这一刻的剧情（可带玩家指令）写提示词并出一张 CG。
   *  落点是**点下这一刻**在时间线上的位置，与剧作家的预发射同一套机制。
   *  referenceCharacters: 选定的参考角色 id（有序多选，编号与提示词对齐）。
   *  useHistory: 是否参考最近剧情与场景，默认 true。
   *  anchorNodeId: 回看中正在看的那一行。带上它 = 提示词按这一刻的剧情写、图挂在这一行
   *  旁边（旁注，不动世界线也不分叉，见 recordCg）；不给 = 落一个 cg 节点在当前世界线末尾。
   *  回看中那一行还没进谱系（这一轮刚演到这儿、客户端还没拉到）时传 `null`：这时退回末尾生图
   *  会往世界线上多落一个节点，所以明确拒绝，不静默换落点。 */
  | {
      type: "generate_cg";
      instruction?: string;
      referenceCharacters?: string[];
      useHistory?: boolean;
      anchorNodeId?: string | null;
    }
  /** 跳转：世界线挂到 nodeId，不生成内容。活节点上往前走，废弃节点上回到那条线。
   *  playFrom: 目标轮次播放头朝向，start=从该轮开头重读，end=直接展露末尾选项（默认）。 */
  | { type: "jump"; nodeId: string; playFrom?: "start" | "end" }
  /** 阅读位置上报：基于稳定 nodeId 寻址，打字机推进时防抖发送，服务端落盘（刷新后回到原处而不是本轮末尾）。 */
  | { type: "read"; nodeId: string; offset: number; seq?: number; len?: number }
  // —— 工坊（D9）：线程管理 + 对话 + 文件编辑；与演出共用一条连接，服务端按 type 分流 ——
  /** 打开面板：回线程列表与当前现场。 */
  | { type: "workshop_open" }
  /** 切到指定线程（回放其消息体）。 */
  | { type: "workshop_activate"; threadId: string }
  /** 发一条工坊消息；不带 threadId 则新建线程。 */
  | { type: "workshop_chat"; threadId?: string; text: string }
  | { type: "workshop_archive"; threadId: string; archived: boolean }
  | { type: "workshop_delete"; threadId: string };

export type { StageEvent, SequencedEvent };
