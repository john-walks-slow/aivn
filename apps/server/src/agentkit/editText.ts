/**
 * 定点文本替换的匹配语义（纯函数，没有 IO 也没有白名单）。
 *
 * 移植自 pi-agent-core 的 `harness/tools/edit-diff.ts`：先精确匹配，不中再做一次
 * 归一化模糊匹配（NFKC / 行尾空白 / 智能引号 / 各种连字符 / 特殊空格）；命中必须唯一、
 * 互不重叠；模糊匹配时只重写被触碰到的行，其余行按原字节拷回，行尾与 BOM 保持原样。
 *
 * 为什么要仿这一套：模型复述原文时经常把 `"` 写成 `“`、行尾多带一个空格，
 * 精确匹配会把这类「其实找得到」的编辑判成失败，模型于是改成整篇重写——那才是丢内容的来源。
 */

export interface TextEdit {
  oldText: string;
  newText: string;
}

export interface AppliedEdits {
  /** 匹配所依据的原文（LF 归一化后）。 */
  baseContent: string;
  /** 替换后的新内容（LF 归一化后）。 */
  newContent: string;
}

export function detectLineEnding(content: string): "\n" | "\r\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1 || crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\n" | "\r\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/** 剥掉 UTF-8 BOM 并单独返回，写回时原样贴回。 */
export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

/** 模糊匹配前的归一化：逐行去尾空白 + 引号/连字符/特殊空格折成 ASCII。 */
export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

export interface FuzzyMatch {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  /** 命中位置所在的坐标系：精确命中是原文，模糊命中是归一化后的文本。 */
  contentForReplacement: string;
}

export function fuzzyFindText(content: string, oldText: string): FuzzyMatch {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content };
  }
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
  if (fuzzyIndex === -1) {
    return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content };
  }
  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

interface LineSpan {
  start: number;
  end: number;
}

interface Replacement {
  editIndex: number;
  matchIndex: number;
  matchLength: number;
  newText: string;
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function getLineSpans(content: string): LineSpan[] {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

function getReplacementLineRange(lines: readonly LineSpan[], replacement: Replacement): { startLine: number; endLine: number } {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (replacementStart >= lines[i]!.start && replacementStart < lines[i]!.end) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) throw new Error("替换范围落在原文之外");
  let endLine = startLine;
  while (endLine < lines.length && lines[endLine]!.end < replacementEnd) endLine++;
  if (endLine >= lines.length) throw new Error("替换范围落在原文之外");
  return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content: string, replacements: readonly Replacement[], offset = 0): string {
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i]!;
    const matchIndex = replacement.matchIndex - offset;
    result = result.slice(0, matchIndex) + replacement.newText + result.slice(matchIndex + replacement.matchLength);
  }
  return result;
}

/**
 * 把「匹配于归一化文本」的替换落到原文上：被替换触碰到的整行按归一化文本重写，
 * 其余行从原文原样拷回（模糊匹配顺带把这一行的引号/空格也归一了，是它的副作用，不是 bug）。
 */
function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: readonly Replacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) throw new Error("替换前后的行数不一致，无法保留未改动的行");

  const groups: { startLine: number; endLine: number; replacements: Replacement[] }[] = [];
  for (const replacement of [...replacements].sort((a, b) => a.matchIndex - b.matchIndex)) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups[groups.length - 1];
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }

  let originalLineIndex = 0;
  let result = "";
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");
    const groupStartOffset = baseLines[group.startLine]!.start;
    const groupEndOffset = baseLines[group.endLine - 1]!.end;
    result += applyReplacements(baseContent.slice(groupStartOffset, groupEndOffset), group.replacements, groupStartOffset);
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join("");
  return result;
}

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

function at(path: string, editIndex: number, totalEdits: number): string {
  return totalEdits === 1 ? path : `${path} 的 edits[${editIndex}]`;
}

/**
 * 把一组定点替换应用到 LF 归一化后的内容上。所有 oldText 都对**同一份原文**匹配，
 * 再按位置从后往前应用，所以偏移不会互相干扰。
 */
export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: readonly TextEdit[],
  path: string,
): AppliedEdits {
  const total = edits.length;
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));
  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i]!.oldText.length === 0) {
      throw new Error(`oldText 不能为空：${at(path, i, total)}。`);
    }
  }

  const usedFuzzyMatch = normalizedEdits.some((edit) => fuzzyFindText(normalizedContent, edit.oldText).usedFuzzyMatch);
  const replacementBaseContent = usedFuzzyMatch ? normalizeForFuzzyMatch(normalizedContent) : normalizedContent;

  const matched: Replacement[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i]!;
    const match = fuzzyFindText(replacementBaseContent, edit.oldText);
    if (!match.found) {
      throw new Error(
        `在 ${at(path, i, total)} 里找不到这段原文。oldText 必须逐字一致（含空白与换行）——先 read_file 拿准原文再改。`,
      );
    }
    const occurrences = countOccurrences(replacementBaseContent, edit.oldText);
    if (occurrences > 1) {
      throw new Error(`${at(path, i, total)} 在文件里出现了 ${occurrences} 次，必须唯一：多带几行上下文把它圈定。`);
    }
    matched.push({ editIndex: i, matchIndex: match.index, matchLength: match.matchLength, newText: edit.newText });
  }

  matched.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matched.length; i++) {
    const previous = matched[i - 1]!;
    const current = matched[i]!;
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(`${at(path, previous.editIndex, total)} 与 ${at(path, current.editIndex, total)} 重叠：并成一处，或改成互不相邻的两处。`);
    }
  }

  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBaseContent, matched)
    : applyReplacements(replacementBaseContent, matched);
  if (normalizedContent === newContent) {
    throw new Error(`没有改动：${path}。替换后的内容和原文一模一样。`);
  }
  return { baseContent: normalizedContent, newContent };
}
