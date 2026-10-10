/**
 * 「数据还没到」的占位：一枚停在正中的 spinner。
 *
 * 原来各页写的是一行「读取中…」的灰字——它跟正文同字号、落在版心左上角，
 * 在一张空页上读起来像一句没写完的话，而不是「正在做事」。
 * 承载它的那一层（工坊各页的 `.workshop-tab-pane`）本来就撑满内容区，
 * 所以这里只管居中，不负责高度。
 */
export function Loading({ label = "读取中" }: { label?: string }) {
  return (
    <div className="pane-loading" role="status" aria-label={label}>
      <span className="spinner" aria-hidden />
    </div>
  );
}
