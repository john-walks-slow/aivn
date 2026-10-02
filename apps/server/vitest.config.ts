import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 生图相关的用例要在本机真编 JPEG/PNG 再抠底（stub 的是网关，不是编解码），
    // 单条能跑到 5s 以上。默认的 5s 是按「只发 HTTP 请求」定的，在这里是纯抖动源：
    // 同一个文件单跑过、并行跑不过。放宽到 20s，不去逐条 override。
    testTimeout: 20_000,
  },
});
