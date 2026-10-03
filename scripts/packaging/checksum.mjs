/**
 * 把 `<文件>.sha256` 写在产物旁边，并把摘要与大小回给调用方打印。
 *
 * Release 页面上只有一个文件名，下载的人没法核对拿到的是不是原物；摘要跟着文件走，
 * `sha256sum -c` / `certutil -hashfile <文件> SHA256` 都能直接比对。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function writeChecksum(file) {
  const bytes = readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(dirname(file), `${basename(file)}.sha256`), `${digest}  ${basename(file)}\n`);
  return { digest, megabytes: (bytes.length / 1024 / 1024).toFixed(1) };
}
