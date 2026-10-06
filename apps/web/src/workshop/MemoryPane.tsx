import { useEffect, useMemo, useState } from "react";
import { api, type PlayFile } from "../api.js";
import { Icon } from "../ui/Icon.js";

const CRAFT_PATH = "memory/always/craft.md";
const PREMISE_PATH = "memory/always/premise.md";

/** 一张记忆卡：`memory/**` 下的一个文本文件。 */
interface Card {
  key: string;
  title: string;
  summary: string;
  path: string;
  readOnly: boolean;
}

/**
 * 记忆：剧目写下来的设定与往事（`memory/**`）——世界与人物设定、创作口径、设定卡。
 *
 * 摆成卡片而不是文件列表：这些不是「文件」，是作者逐条在维护的设定条目。
 * 列表 + 侧栏那套布局和「文件」页没有区别，等于给同一件事两个入口。
 *
 * 常驻设定（`memory/always/`）每轮都注入，设定卡按标题注入、详情按需读——
 * 副标题就写这件事，用户不必知道目录结构也能判断哪张卡是「一直在起作用」的。
 * 角色不在这里：角色是剧目的一等公民，有自己的一页。剧目字段在「剧目」页。
 */
export function MemoryPane({ playId, revision }: { playId: string; revision: number }) {
  const [files, setFiles] = useState<PlayFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(PREMISE_PATH);
  /** 记忆卡的本地正文：只在打开某一张时拉，避免为每张都占一份 state。 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 盘上那一份（读回来时记下、保存成功后同步）：改没改过由它俩比出来。 */
  const [onDisk, setOnDisk] = useState<Record<string, string>>({});

  useEffect(() => {
    api.listFiles(playId).then(setFiles).catch((e: Error) => setError(e.message));
  }, [playId, revision]);

  /** 展开哪张就现拉哪张：不为每张记忆卡常驻一份正文。 */
  useEffect(() => {
    if (!open) return;
    const path = open;
    let alive = true;
    const read = path === CRAFT_PATH ? api.craft(playId) : api.readFile(playId, path);
    void read
      .then(({ content }) => {
        if (!alive) return;
        setDrafts((prev) => ({ ...prev, [path]: content }));
        setOnDisk((prev) => ({ ...prev, [path]: content }));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, playId]);

  const saveFile = (path: string): void => {
    const body = drafts[path];
    if (body === undefined) return;
    api
      .saveFile(playId, path, body)
      .then(() => {
        setOnDisk((prev) => ({ ...prev, [path]: body }));
        setJustSaved(true);
      })
      .catch((e: Error) => setError(e.message));
  };

  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    for (const f of files) {
      // 只有剧目记忆进这一页：archive 是机器写的逐轮切片，列出来只会让人以为能改
      if (!f.path.startsWith("memory/")) continue;
      if (f.path.startsWith("memory/archive/")) continue;
      out.push({
        key: f.path,
        title: titleOf(f),
        summary: groupOf(f.path),
        path: f.path,
        readOnly: f.writable === false,
      });
    }
    out.sort((a, b) => rankOf(a.path) - rankOf(b.path));
    return out;
  }, [files]);

  const active = cards.find((c) => c.key === open) ?? null;
  const body = active ? drafts[active.path] ?? "" : "";
  const dirty = active !== null && body !== (onDisk[active.path] ?? "");

  return (
    <div className="workshop-tab-pane setting-cards-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="setting-cards">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`setting-card${open === card.key ? " active" : ""}`}
            onClick={() => setOpen(card.key)}
          >
            <Icon name="memory" size={14} />
            <span className="setting-card-title">{card.title}</span>
            <span className="setting-card-summary">{card.summary}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        {active === null ? (
          <p className="muted small">选一张设定卡开始读或改。</p>
        ) : (
          <>
            <h3>{active.title}</h3>
            {active.readOnly ? (
              <p className="muted small">
                这份由引擎自动写入，改了会在下一轮被覆盖。去「对话」里让工坊处理。
              </p>
            ) : null}
            <FileEditor
              value={body}
              readOnly={active.readOnly}
              dirty={dirty}
              onChange={(v) => {
                setJustSaved(false);
                setDrafts((prev) => ({ ...prev, [active.path]: v }));
              }}
              onSave={() => saveFile(active.path)}
              placeholder={HINTS[active.path] ?? ""}
            />
            {justSaved && <span className="muted small">已保存</span>}
          </>
        )}
      </section>
    </div>
  );
}

const TITLES: Record<string, string> = {
  [PREMISE_PATH]: "世界与人物设定",
  [CRAFT_PATH]: "创作口径",
};

/**
 * 两份常驻设定的空态提示。
 *
 * 新剧目这两份是空的。「该怎么写」的话一旦存进文件就成了设定的一部分，剧作家会当成人写的
 * 内容照读（写作指引混进设定，是模板化剧目的起点），所以引导只留在占位符里：
 * 看得见、存不进去、不进模型。
 */
const HINTS: Record<string, string> = {
  [PREMISE_PATH]:
    "世界在哪儿、什么年代、什么规矩；主要人物是谁、彼此什么关系。\n留空也能开演，剧作家会自己发挥。",
  [CRAFT_PATH]:
    "这部剧专有的文风与禁忌：台词腔调、称呼习惯、叙述视角、什么不能写。\n「每轮多长、给几个选项、素材从哪来」不在这里，在「剧目」页的写作参数里。",
};

/** 记忆卡所属的组（卡片副标题）：常驻设定先摆，因为它每轮都注入。 */
function rankOf(path: string): number {
  return path.startsWith("memory/always/") ? 0 : 1;
}

function groupOf(path: string): string {
  return path.startsWith("memory/always/") ? "常驻设定 · 每轮都注入" : "设定卡 · 按需读";
}

/** 记忆卡的标题：两份常驻设定给名字，其余取路径末段；子目录里的卡带目录名以免同名分不清。 */
function titleOf(file: PlayFile): string {
  if (TITLES[file.path]) return TITLES[file.path]!;
  const parts = file.path.split("/");
  const name = (parts.pop() ?? file.path).replace(/\.md$/, "");
  const parent = parts.pop();
  return parent ? `${name}（${parent}）` : name;
}

function FileEditor({
  value,
  readOnly,
  dirty,
  placeholder,
  onChange,
  onSave,
}: {
  value: string;
  readOnly: boolean;
  /** 与盘上那份不一致。基准由上面那份 state 持有：组件自己记基准会让「刚敲一个字」也变成没改过。 */
  dirty: boolean;
  /** 空态提示（只给两份常驻设定，其余记忆卡没有）。 */
  placeholder?: string;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <>
      <textarea
        className="file-body"
        readOnly={readOnly}
        rows={18}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {!readOnly && (
        <p className="row">
          <button className="primary" disabled={!dirty} onClick={onSave}>
            保存
          </button>
        </p>
      )}
    </>
  );
}
