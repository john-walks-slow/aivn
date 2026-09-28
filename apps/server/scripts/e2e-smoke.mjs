import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:8787");
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let said = "";

ws.on("open", () => log("connected"));
ws.on("error", (e) => { console.error("WS ERROR", e.message); process.exit(1); });
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  switch (msg.type) {
    case "hello": log("hello lastSeq=", msg.lastSeq); break;
    case "beat_start": log("beat_start", msg.beatId); break;
    case "events":
      for (const { seq, event } of msg.events) {
        if (event.kind === "say_start") log("  [say]", event.id, event.mood ?? "");
        else if (event.kind === "say_text") { said += event.delta; }
        else if (event.kind === "say_end") { log("  台词:", said.trim().slice(0, 60)); said = ""; }
        else if (event.kind === "narrate_start") log("  [旁白]");
        else if (event.kind === "scene") log("  [场景]", event.bg, event.bgm ?? "");
        else if (event.kind === "actor") log("  [立绘]", event.id, event.expression ?? "");
        else if (event.kind === "stop") log("  [停止点]", event.stopType, JSON.stringify(event.options ?? event.placeholder ?? ""));
        else if (event.kind === "thought_start") log("  [内心]", event.id);
      }
      break;
    case "beat_end":
      log("beat_end", msg.reason, msg.stop?.stopType ?? "");
      // 第一拍结束 → 选第一个选项
      if (msg.reason === "stop" && !globalThis.sentChoice) {
        globalThis.sentChoice = true;
        setTimeout(() => { log("→ 选择选项 #0"); ws.send(JSON.stringify({ type: "player_choice", optionIndex: 0 })); }, 500);
      } else if (msg.reason === "act_end") {
        log("E2E-OK 两拍闭环完成");
        ws.close(); process.exit(0);
      }
      break;
    case "error": log("ERROR:", msg.message); break;
  }
});
setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 240000);
