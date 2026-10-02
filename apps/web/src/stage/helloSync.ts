/**
 * 首屏 hello 怎么解读：这是「第一次对上账」，还是「换了一棵树」。
 *
 * 分错的后果不是多放一遍事件，是阅读进度当场作废：换树/换代都判真时
 * `setReadPos(null)`，刷新一下就回到本轮末尾——首屏每次都判成换代，因为
 * epochRef 从 0 起、saveIdRef 是空串，服务端报什么都跟它们不一样。
 * 首屏与真换代在外部行为上必须分开：首屏只要把服务端的 saveId/epoch 认下来。
 */

export interface HelloSyncInput {
  /** 这条连接此前收到过 hello 吗（false = 首屏）。 */
  seen: boolean;
  /** 客户端本地记着的周目 id（首屏为 null）。 */
  saveId: string | null;
  /** 服务端 hello 报的周目 id（空串 = 这棵剧目还没有周目）。 */
  helloSaveId: string | undefined;
  /** 客户端本地记着的缓冲代号。 */
  epoch: number;
  /** 服务端 hello 报的缓冲代号。 */
  helloEpoch: number | undefined;
}

export interface HelloSync {
  /** 换了一棵周目树：本地缓冲作废，整段重放。 */
  switched: boolean;
  /** 缓冲被结构性操作整段替换（分岔/重写）：本地 seq 作废，整段重放。 */
  restamped: boolean;
  /** 服务端报什么就认什么（首屏也要更新本地的 saveId/epoch）。 */
  adoptedSaveId: string | undefined;
  adoptedEpoch: number | undefined;
}

export function helloSync(input: HelloSyncInput): HelloSync {
  const switched =
    input.seen && input.helloSaveId !== undefined && input.helloSaveId !== input.saveId;
  // 代号不一致只有在「不是换了树」时才叫换代：换了树时 seq 早已整段作废，再报一次换代只会多放一遍。
  const restamped =
    input.seen &&
    input.helloEpoch !== undefined &&
    input.helloEpoch !== input.epoch &&
    !switched;
  return {
    switched,
    restamped,
    adoptedSaveId: input.helloSaveId,
    adoptedEpoch: input.helloEpoch,
  };
}
