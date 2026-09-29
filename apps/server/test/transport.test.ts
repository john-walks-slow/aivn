import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { PlayHouse, PlayRuntime } from "../src/playhouse.js";
import { attachTransport } from "../src/transport.js";

/** 假 PlayHouse：只提供 transport 用到的三个入口，把 setTtsState 调用记下来。 */
function fakePlayhouse() {
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
  };
  const playhouse = {
    get: (): Promise<PlayRuntime> => Promise.resolve(runtime as unknown as PlayRuntime),
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

function connect(url: string, query = ""): Promise<WebSocket> {
  const socket = new WebSocket(`${url}/ws?play=demo${query}`);
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
