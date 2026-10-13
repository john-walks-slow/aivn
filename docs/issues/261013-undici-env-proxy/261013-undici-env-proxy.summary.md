# 261013-undici-env-proxy：服务端通用出口代理与回环直连修复

## 背景与根因

1. **userland `undici` 冲掉全局代理 dispatcher**：Node 22 在 `NODE_USE_ENV_PROXY=1` 下会将 `globalThis[Symbol(undici.globalDispatcher.1)]` 设为 `EnvHttpProxyAgent`，但服务端任意模块 `import "undici"` 时，userland `undici@8` 会将该全局符号覆盖为裸 `Agent`（无代理），导致 `globalThis.fetch` 与默认 `undiciFetch` 全部丢失环境代理。
2. **生图与音乐工厂未接入环境代理**：`imageFactory.ts`、`novelaiImage.ts`、`musicFactory.ts` 直接调用裸 `undiciFetch`，且原先 `webImage.ts` 的 `proxyFromEnv()` 使用 `ProxyAgent`（不区分本机回环与外部域名，若直接给生图用会把 `127.0.0.1:38000` 也送进代理）。

## 修改内容

- [`apps/server/src/webImage.ts`](../../../apps/server/src/webImage.ts)：`proxyFromEnv()` 改用 `EnvHttpProxyAgent`，默认将 `localhost,127.0.0.1,::1` 并入 `noProxy` 并按环境变量值缓存实例；导出通用 `envFetch` 与 `installEnvProxy()`。
- [`apps/server/src/index.ts`](../../../apps/server/src/index.ts)：在 `loadEnvFile()` 之后调用 `installEnvProxy()`，确保 `.env` 中的 `HTTP_PROXY` / `HTTPS_PROXY` 同步装入全局 dispatcher。
- [`apps/server/src/imageFactory.ts`](../../../apps/server/src/imageFactory.ts)、[`apps/server/src/novelaiImage.ts`](../../../apps/server/src/novelaiImage.ts)、[`apps/server/src/musicFactory.ts`](../../../apps/server/src/musicFactory.ts)：统一接入 `envFetch`。
- [`apps/server/src/novelaiImage.ts`](../../../apps/server/src/novelaiImage.ts)：垫图按「同画幅单张重绘 vs 跨画幅/多图角色参考」分流——同画幅单张参考图（立绘差分）走 `img2img`（1K 档 0 Anlas），跨画幅单张参考图或多张参考图（立绘垫 16:9 CG / 多人 CG）在 V4.5 下走 `director_reference_images`（白底 `1024×1536` 归一化），并通过 `stripReferenceMeta` 剥离多模态专属的 `"The attached reference images are..."` 尾注。
- [`apps/server/test/webImage.test.ts`](../../../apps/server/test/webImage.test.ts)、[`apps/server/test/novelaiImage.test.ts`](../../../apps/server/test/novelaiImage.test.ts)：补充回环直连与 V4.5 跨画幅/多参考图单测。
