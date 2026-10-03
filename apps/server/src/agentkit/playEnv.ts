import { isAbsolute, relative } from "node:path";
import {
  err,
  FileError,
  ok,
  type Context,
  type Result,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { parsePlayConfig } from "@stage-ai/core";
import type { PlayFiles } from "../playFiles.js";
import type { WorkshopWrite } from "./deps.js";
import { reason } from "./result.js";

/**
 * 工坊 agent 的执行环境：pi 的 `NodeExecutionEnv`（纯 Node、跨平台，16 个 FileSystem 方法现成）
 * 外面套一层剧目白名单。**这是装饰，不是重写。**
 *
 * pi 的 read / write / edit 实际只用得到 `absolutePath`（三个工具唯一的路径入口，经
 * `path-utils.ts` 的 `resolveToolPath`）、`readBinaryFile`、`readTextFile`、`fileInfo`、`writeFile`；
 * bash 只用 `cwd` 与 `exec`。所以白名单只要卡住两个口子：
 *
 * - `absolutePath` —— 读面，read / write / edit 都得先从这儿过；
 * - `writeFile` —— 写面，唯一的写出口（白名单 + play.json 结构校验 + 撤销条三件事都在这）。
 *
 * **bash 不经过这一层**：它继承 `NodeExecutionEnv.exec`，跑在同一台机器、同一个用户下。
 * 白名单管的是 read / write / edit 这三个结构化工具（它们要过校验、要挂撤销条），
 * 不是一道进程边界——要边界得靠部署（容器 / 独立用户），代码里不自己造。
 */
export class PlayEnv extends NodeExecutionEnv {
  constructor(
    private readonly files: PlayFiles,
    private readonly onWrite: (write: WorkshopWrite) => void,
  ) {
    super({ cwd: files.root });
  }

  override async absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    const abs = await super.absolutePath(path, context);
    if (!abs.ok) return abs;
    const denial = this.denial(abs.value, "read");
    return denial ? err(denial) : abs;
  }

  override async writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const abs = await super.absolutePath(path, context);
    if (!abs.ok) return abs;
    const denial = this.denial(abs.value, "write");
    if (denial) return err(denial);

    const clean = relative(this.files.root, abs.value);
    const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
    if (clean === "play.json") {
      try {
        parsePlayConfig(JSON.parse(text));
      } catch (error) {
        // 这条消息只有走 `write` 才原样回给模型：pi 的 edit 会把这里的失败包成
        // 「Could not edit file: …. Error code: invalid.」，具体原因只留在 cause 上。
        // 拦得住才是这一层的目的，不为消息粒度再造第二套错误面。
        return err(new FileError("invalid", `play.json 结构校验不过，未落盘：${reason(error)}`, abs.value));
      }
    }

    let before: string | null = null;
    try {
      before = await this.files.read(clean);
    } catch {
      before = null;
    }
    try {
      await this.files.write(clean, text);
    } catch (error) {
      return err(new FileError("permission_denied", reason(error), abs.value));
    }
    this.onWrite({ path: clean, before, after: text });
    return ok<void, FileError>(undefined);
  }

  /**
   * 路径不在剧目目录内、或不在白名单对应面上，就拒。
   *
   * 读面与写面共用这一个判定，只是模式不同——`absolutePath` 是读，`writeFile` 是写。
   * 写面在 `PlayFiles.write` 里还会再校验一次，这里早拒一步只是为了错误消息说得准。
   */
  private denial(abs: string, mode: "read" | "write"): FileError | null {
    const clean = relative(this.files.root, abs);
    if (clean === "" || clean.startsWith("..") || isAbsolute(clean)) {
      return new FileError("permission_denied", `路径不在剧目目录内：${abs}`, abs);
    }
    try {
      this.files.pathOf(clean, mode);
    } catch (error) {
      return new FileError("permission_denied", reason(error), abs);
    }
    return null;
  }
}
