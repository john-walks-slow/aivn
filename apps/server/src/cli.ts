/**
 * 命令行入口参数。
 *
 * 为什么 exe 需要它：双击 exe 没有命令行可用，所以**任何东西都不该只能靠参数配置**——
 * 这些开关只解决「换个端口/换个数据目录/别自动开浏览器」这类启动期的事，用户平时不用碰。
 * 运行期设置（网关、密钥、生图…）全在设置页里，不在这里，也不在 `.env` 里。
 *
 * 优先级：命令行 > 环境变量 > 默认值（`loadBootstrap` 负责后两级）。
 */

export interface LaunchOptions {
  /** `--help`：调用方打印 USAGE 后直接退出。 */
  help: boolean;
  port?: number;
  host?: string;
  dataDir?: string;
  /** 未指定时由调用方决定默认值（打包态默认开，开发态默认关）。 */
  open?: boolean;
  /** 只做启动自检（资源、技能库、sharp、数据目录可写）然后退出，不起服务。 */
  selftest: boolean;
}

export const USAGE = `用法：stage-ai.exe [选项]

  -p, --port <端口>      监听端口（默认 8787，被占用时自动往后找；0 = 随便挑一个空闲的）
      --host <地址>      监听地址（默认 0.0.0.0，即同一局域网都能访问）
      --data-dir <目录>  数据目录（默认 exe 同级的 data/）
      --open             启动后打开默认浏览器（打包版默认打开）
      --no-open          启动后不打开浏览器
      --selftest         体检打包后的资源与依赖（sharp 等），然后退出
  -h, --help             显示这段说明

端口、数据目录也可以在 exe 旁边放一个 .env（STAGE_PORT / STAGE_DATA_DIR / STAGE_HOST）。
其余设置都在浏览器里的「设置」页，改完立即生效。`;

export class UsageError extends Error {}

export function parseLaunchArgs(argv: string[]): LaunchOptions {
  const options: LaunchOptions = { help: false, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`选项 ${arg} 后面缺一个值`);
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-p":
      case "--port": {
        const value = next();
        const port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new UsageError(`端口 "${value}" 不合法，应该是 0–65535 的整数（0 = 自动挑一个空闲的）`);
        }
        options.port = port;
        break;
      }
      case "--host":
        options.host = next();
        break;
      case "--data-dir":
        options.dataDir = next();
        break;
      case "--selftest":
        options.selftest = true;
        break;
      case "--open":
        options.open = true;
        break;
      case "--no-open":
        options.open = false;
        break;
      default:
        throw new UsageError(`不认识的选项：${arg}`);
    }
  }
  return options;
}
