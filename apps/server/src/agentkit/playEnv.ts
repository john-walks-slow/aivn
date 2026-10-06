import { isAbsolute, relative } from "node:path";
import {
  err,
  FileError,
  ok,
  type Context,
  type Result,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { PlayFiles, WriteScope } from "../playFiles.js";
import { isGenerated, inWriteScopes, writeScopeOf, WRITE_SCOPE_LABELS } from "../playFiles.js";
import type { PlayFileWrite } from "./deps.js";
import { reason } from "./result.js";

/**
 * 这个角色的手能伸到哪儿。两件事：
 *
 * - `writeScopes` —— 能改哪几类文件。**能力（capability）给的就是这个**：剧作家可能只有
 *   `memory`（记忆开着、「管理角色」关着），工坊则可能三位全给或一位都不给。
 * - `readGenerated` —— 通用读口认不认引擎产物（`memory/archive`）。
 *   它跟分支走、按 pathSet 过滤，而文件是剧目级的：通用 read 能读出来，等于把别的
 *   世界线的往事摊开。剧作家不给，要看往事走 `search_archive`；工坊看得见
 *   （它要能读用户手上的剧目全貌）。
 */
export interface PlayEnvPolicy {
  writeScopes: readonly WriteScope[];
  readGenerated: boolean;
}

/**
 * 两个 agent 共用的执行环境：pi 的 `NodeExecutionEnv`（纯 Node、跨平台，16 个 FileSystem 方法现成）
 * 外面套一层剧目白名单。**这是装饰，不是重写。**
 *
 * pi 的 read / write / edit 实际只用得到 `absolutePath`（三个工具唯一的路径入口，经
 * `path-utils.ts` 的 `resolveToolPath`）、`readBinaryFile`、`readTextFile`、`fileInfo`、`writeFile`；
 * bash 只用 `cwd` 与 `exec`。所以白名单只要卡住两个口子：
 *
 * - `absolutePath` —— 读面，read / write / edit 都得先从这儿过；
 * - `writeFile` —— 写面，早拒一次（错误消息说得准些）；真正落盘走
 *   `PlayFiles.write`，路径白名单与 play.json 结构校验都收在那个口子上。
 *
 * **bash 不经过这一层**：它继承 `NodeExecutionEnv.exec`，跑在同一台机器、同一个用户下。
 * 白名单管的是 read / write / edit 这三个结构化工具（它们要过校验），
 * 不是一道进程边界——要边界得靠部署（容器 / 独立用户），代码里不自己造。
 */
export class PlayEnv extends NodeExecutionEnv {
  constructor(
    private readonly files: PlayFiles,
    private readonly policy: PlayEnvPolicy,
    private readonly onWrite: (write: PlayFileWrite) => void,
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

    try {
      await this.files.write(clean, text);
    } catch (error) {
      // play.json 的结构校验失败与真实 I/O 失败共用这一条消息通道。
      // 只有走 `write` 才原样回给模型：pi 的 `edit` 会把它包成
      // 「Could not edit file: …. Error code: invalid.」，具体原因只留在 cause 上——
      // 拦得住才是这一层的目的，不为消息粒度再造第二套错误面。
      const code = clean === "play.json" ? "invalid" : "permission_denied";
      return err(new FileError(code, reason(error), abs.value));
    }
    this.onWrite({ path: clean });
    return ok<void, FileError>(undefined);
  }

  /**
   * 路径不在剧目目录内、不在白名单对应面上、或不在这个角色的能力面内，就拒。
   *
   * 读面与写面共用这一个判定，只是模式不同——`absolutePath` 是读，`writeFile` 是写。
   * 写面在 `PlayFiles.write` 里还会再校验一次，这里早拒一步只是为了错误消息说得准：
   * 「剧目里根本没有这条路径」与「本剧目没给这个角色开这项能力」是两回事，
   * 模型看到后者才会去想让用户开工坊，而不是换个路径再试。
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
    if (mode === "read") {
      if (!this.policy.readGenerated && isGenerated(clean)) {
        return new FileError(
          "permission_denied",
          // 这条按路径的口对读写两件事都关着（write 也会先经过 absolutePath 解析路径），
          // 所以消息把两条都说清：引擎产物不是给人手改的，往事要走带分支过滤的工具。
          `引擎产物走不了通用读写口：${clean}（往事走 read_memory_detail / search_archive，` +
            `别按路径翻、也别手改）`,
          abs,
        );
      }
      return null;
    }
    if (!inWriteScopes(clean, this.policy.writeScopes)) {
      const scope = writeScopeOf(clean);
      const what = scope ? WRITE_SCOPE_LABELS[scope] : "这类文件";
      return new FileError(
        "permission_denied",
        `本剧目没给这个角色开改${what}的能力：${clean}`,
        abs,
      );
    }
    return null;
  }
}
