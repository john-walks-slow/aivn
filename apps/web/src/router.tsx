import { useEffect, useState } from "react";

/** hash 路由：#/ 、#/settings、#/play/:id、#/play/:id/stage。工坊是浮层，没有路由。 */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path = "/", search = ""] = hash.split("?");
  return {
    path,
    segments: path.split("/").filter(Boolean),
    query: new URLSearchParams(search),
  };
}

export function navigate(to: string): void {
  location.hash = to;
}

/**
 * 设置页地址。`from` 记下「从哪儿进来的」——设置页顶栏的返回键按它回退，
 * 缺省（剧目库的「⚙ 设置」）回剧目库。剧目标题页要传自己的地址，
 * 否则从剧目里进设置、退出时会被丢回首页。
 */
export function settingsUrl(from?: string): string {
  return from ? `/settings?from=${encodeURIComponent(from)}` : "/settings";
}

/** 设置页该回哪儿：`from` 只认站内路径（`/play/<id>` 这类），认不出就回剧目库。 */
export function settingsReturnFrom(search: string | null | undefined): string {
  const from = new URLSearchParams(search ?? "").get("from");
  return from && /^\/[^/]/.test(from) ? from : "/";
}

/** 与 navigate 同构但替换当前历史条目（不留记录；触发 hashchange 同步 useRoute）。 */
export function replace(to: string): void {
  location.replace(`${location.pathname}#${to}`);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = (): void => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
