import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { PlayHouse, PlayRuntime } from "../src/playhouse.js";
import { attachTransport } from "../src/transport.js";

/** 假 PlayHouse：只提供 transport 用到的入口，把 setTtsState 调用记下来。 */
function fakePlayhouse(failPlay?: string) {
  const tts: { enabled?: boolean; paused?: boolean }[] = [];
  const runtime = {
    orchestrator: {
      lastSeq: 0,
      currentEpoch: 1,
      isBusy: false,
      stoppedReplay: undefined,
      autostart: (): void => {},
      setTtsState: (state: { enabled?: boolean; paused?: boolean }): void => {
        tts.push(state);
      },
    },
    cast: [],
    voice: true,
    save: { id: "stest", name: "第 1 周目" },
    // hello 会读这两项，缺了 sendHello 就在连接建立后炸一个未捕获异常
    pending: { snapshot: (): [] => [] },
    assetsTtlMs: 0,
  };
  const missing = (): Promise<PlayRuntime> =>
    Promise.reject(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }));
  const resolve = (): Promise<PlayRuntime> => Promise.resolve(runtime as unknown as PlayRuntime);
  const playhouse = {
    // 舞台连上走 stage（缺周目才建），逛工坊走 get（不建）
    stage: (playId: string): Promise<PlayRuntime> => (playId === failPlay ? missing() : resolve()),
    get: (playId: string): Promise<PlayRuntime> => (playId === failPlay ? missing() : resolve()),
    peek: (): PlayRuntime => runtime as unknown as PlayRuntime,
    clientsFor: (): Set<(msg: unknown) => void> => new Set(),
  };
  return { playhouse: playhouse as unknown as PlayHouse, tts };
}

const servers: WebSocketServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function serve(playhouse: PlayHouse): Promise<string> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(wss);
  attachTransport(wss, playhouse);
  await new Promise<void>((resolve) => wss.on("listening", resolve));
  const address = wss.address();
  if (typeof address === "string" || address === null) throw new Error("未拿到监听地址");
  return `ws://127.0.0.1:${address.port}`;
}

function connect(url: string, query = "", playId = "demo"): Promise<WebSocket> {
  const socket = new WebSocket(`${url}/ws?play=${playId}${query}`);
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

/** 服务端 close 是异步落地的，轮询等 setTtsState 记录出现。 */
async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("等待超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("transport 语音存活", () => {
  it("最后一个舞台连接断开 → 停合成", async () => {
    const { playhouse, tts } = fakePlayhouse();
    const url = await serve(playhouse);
    const socket = await connect(url);

    socket.close();
    await until(() => tts.length > 0);
    expect(tts).toEqual([{ enabled: false }]);
  });

  it("还有别的舞台连接时不打断", async () => {
    const { playhouse, tts } = fakePlayhouse();
    const url = await serve(playhouse);
    const first = await connect(url);
    await connect(url);

    first.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tts).toEqual([]);
  });

  it("工坊连接不算观众：舞台走了就停，工坊自己断开不重复停", async () => {
    const { playhouse, tts } = fakePlayhouse();
    const url = await serve(playhouse);
    const stage = await connect(url);
    const workshop = await connect(url, "&workshop=1");

    stage.close();
    await until(() => tts.length > 0);
    expect(tts).toEqual([{ enabled: false }]);

    workshop.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tts).toEqual([{ enabled: false }]);
  });

  it("工坊单独连接不触发停合成", async () => {
    const { playhouse, tts } = fakePlayhouse();
    const url = await serve(playhouse);
    const workshop = await connect(url, "&workshop=1");

    workshop.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tts).toEqual([]);
  });
});

/** 连一个剧目，从建连起就把收到的帧与关闭码收好（消息可能在 await open 之前就到）。 */
function watch(url: string, playId: string): {
  frames: { type: string; message?: string; recoverable?: boolean }[];
  closed: Promise<number>;
} {
  const frames: { type: string; message?: string; recoverable?: boolean }[] = [];
  const socket = new WebSocket(`${url}/ws?play=${playId}`);
  sockets.push(socket);
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  socket.on("message", (data) => frames.push(JSON.parse(String(data))));
  return { frames, closed };
}

describe("transport 剧目打不开", () => {
  it("回一帧不可恢复的错误再关连接，不带崩进程，观众计数也不漏", async () => {
    const { playhouse, tts } = fakePlayhouse("gone");
    const url = await serve(playhouse);

    const bad = watch(url, "gone");
    await bad.closed;
    expect(bad.frames).toHaveLength(1);
    expect(bad.frames[0]?.type).toBe("error");
    expect(bad.frames[0]?.recoverable).toBe(false);
    expect(bad.frames[0]?.message).toContain("gone");

    // 计数漏了这一个观众的话，后面这条正常连接关掉时就判不出「最后一个」
    const good = await connect(url);
    good.close();
    await until(() => tts.length > 0);
    expect(tts).toEqual([{ enabled: false }]);
  });
});
