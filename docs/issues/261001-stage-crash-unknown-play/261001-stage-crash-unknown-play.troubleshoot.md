# 剧目不存在时 WS 连接带走整个 API 进程 排查

**状态：已修复（2026-10-01，分支 `feat/cg-director`）。**

## 现象

`ws://<host>:<port>/ws?play=<不存在的剧目 id>`：

- API 进程立刻退出（`node` 崩掉，不是这次连接被拒），**所有剧目的连接一起断**。
- 客户端侧只看到 WS 握手成功后被断开，没有服务端错误帧。
- 复现门槛很低：浏览器里手改地址栏、别的 worktree 的残留客户端连错端口、收藏夹里的旧剧目链接。

## 根因

`apps/server/src/transport.ts::onConnection` 里建立 runtime 的那段是个**没人接的 async IIFE**：

```ts
void (async () => {
  const runtime = await (stage ? playhouse.stage(playId) : playhouse.get(playId));
  ...
})();
```

`playhouse.stage()` / `get()` 会 `loadPlay()` 读 `plays/<id>/play.json`，剧目不存在时抛 `ENOENT`。
`void` 掉一个会抛的 promise = unhandled rejection，Node 的默认策略是**终止进程**。
`ws.on("message")` 里那个 `dispatchSafe()` 有 `.catch`，`ws.on("error")` 也有——唯独这个 IIFE 没有。

## 修法

连接建立时就地收场，不让异常逃出去：

```ts
let runtime: PlayRuntime;
try {
  runtime = await (stage ? playhouse.stage(playId) : playhouse.get(playId));
} catch (error) {
  // 先把观众计数还回去：drop() 只在 close 时跑，那时要靠 dropped 标记才不会二次减
  ...
  sender({ type: "error", message: `剧目打不开：${playId}（${message}）`, recoverable: false });
  ws.close(1008, "剧目不存在");
  return;
}
```

要点：

- **必须手动归还 `stageConnections`**：这行计数是「最后一个观众离场 → 停 TTS 调度」的判据。
  连接没走到 `drop()` 之前就 return 了，计数会永远多一个。所以先置 `dropped = true`，
  让随后 `close` 触发的 `drop()` 看见标记、不再减一次。
- `recoverable: false`：这不是可以重试的瞬时错误，剧目就是不存在，重连多少次都一样。
- 顺手加的测试夹具修正：`transport.test.ts` 里 `fakePlayhouse` 之前对任何 play id 都返回 runtime，
  所以 `sendHello` 一直读到 `undefined` 的 `pending` / `assetsTtlMs` 并抛未捕获异常——测试其实是绿的假象。

## 验证

`apps/server/test/transport.test.ts` 新增 describe「transport 剧目打不开」：

- 剧目不存在 → 收到一帧 `error` 且 `recoverable === false`，随后连接以 1008 关闭。
- 此时进程仍然活着：紧接着用一个正常剧目 id 再连一条，成功收到 `hello`。

反向验证：把 `transport.ts` 换回 HEAD 版本后同一条用例直接 **Unhandled Rejection** 并失败。

## 关联

由 `docs/issues/261001-route-update-loop/` 的排查过程顺带发现；同批修复见 `feat/cg-director`。