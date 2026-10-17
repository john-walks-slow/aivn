/**
 * 新会话的开场建议。每条都是一句可以直接发出去的话，点一下填进输入框——填不自动发，
 * 用户还能改。所以文案要写成「他真会说出口的那句」，不是标签式的题材名。
 */

export type StarterKind = "original" | "fanfic" | "adaptation" | "form";

export interface StarterIdea {
  kind: StarterKind;
  text: string;
}

/** 抽签时的类别顺序；条数不够时排在前面的类别先让位给后面的。 */
const KINDS: StarterKind[] = ["original", "fanfic", "adaptation", "form"];

export const STARTER_IDEAS: StarterIdea[] = [
  { kind: "original", text: "构思一个充满和风神怪色彩的现代轻喜剧，主角经营着一家能听见万物心声的旧茶铺" },
  { kind: "original", text: "我想要一个赛博朋克侦探故事，主角是个记不住人脸的女高中生" },
  { kind: "original", text: "一家只在雨夜开门的旧书店，店主能听见书里人物的抱怨" },
  { kind: "original", text: "月球基地的最后一名维修工，和一台开始撒谎的 AI" },
  { kind: "original", text: "小镇的失物招领处，收到的都是还没丢的东西" },
  { kind: "original", text: "一支解散十年的乐队，因为一场葬礼重新凑到一起" },

  { kind: "fanfic", text: "以《哈利·波特》的世界观，写一个麻瓜出身的转学生的日常" },
  { kind: "fanfic", text: "用《西游记》的角色，写取经结束五百年后的一次重逢" },
  { kind: "fanfic", text: "假如《新世纪福音战士》里有一个使徒选择站在人类这边" },
  { kind: "fanfic", text: "从《三国演义》里一个从没上过战场的运粮兵眼里看那场战争" },

  { kind: "adaptation", text: "把《了不起的盖茨比》搬到 1930 年代的上海" },
  { kind: "adaptation", text: "用《聊斋志异》的笔法改写《哈姆雷特》" },
  { kind: "adaptation", text: "把《变形记》改成 996 上班族的一个早晨" },
  { kind: "adaptation", text: "将《罗密欧与朱丽叶》改写成两家 AI 公司之间的故事" },
  { kind: "adaptation", text: "把《傲慢与偏见》改成一场相亲节目的录制" },

  { kind: "form", text: "一部没有台词的视觉小说，只靠动作和场景讲完" },
  { kind: "form", text: "玩家每做一次选择，主角就会忘记一件事" },
  { kind: "form", text: "用四封信讲完一段跨越三十年的关系" },
  { kind: "form", text: "全程发生在一部电梯里的悬疑故事" },
];

/**
 * 抽 count 条互不重复的建议：每个类别先各出一条（一轮里原创、同人、改编、形式都能见到），
 * 不够再从剩下的补，最后打乱顺序——否则第一条永远是「原创」。
 * random 可注入，只为测试时能定死结果。
 */
export function pickStarters(count = 4, random: () => number = Math.random): StarterIdea[] {
  const byKind = new Map<StarterKind, StarterIdea[]>();
  for (const idea of STARTER_IDEAS) {
    const list = byKind.get(idea.kind);
    if (list) list.push(idea);
    else byKind.set(idea.kind, [idea]);
  }

  const picked: StarterIdea[] = [];
  for (const kind of KINDS) {
    if (picked.length >= count) break;
    const list = byKind.get(kind);
    if (list && list.length > 0) picked.push(...list.splice(Math.floor(random() * list.length), 1));
  }

  const rest = [...byKind.values()].flat();
  while (picked.length < count && rest.length > 0) {
    picked.push(...rest.splice(Math.floor(random() * rest.length), 1));
  }

  for (let i = picked.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = picked[i]!;
    const b = picked[j]!;
    picked[i] = b;
    picked[j] = a;
  }
  return picked;
}
