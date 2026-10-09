import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 抠底那几条要在真图上跑 sharp 抠色键（千像素级的合成图），本机（8G 手机容器）
    // 在同时跑别的套件时会超过默认的 5s——偶发的超时是机器忙，不是算法变慢。
    testTimeout: 30_000,
  },
});
