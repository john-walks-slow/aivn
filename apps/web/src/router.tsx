import { useEffect, useState } from "react";

/** hash 路由：#/ 、#/play/:id、#/play/:id/saves、#/play/:id/stage、#/play/:id/assets。 */
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
