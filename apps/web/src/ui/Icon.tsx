import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CornerUpLeft,
  Crosshair,
  Download,
  FolderOpen,
  GitBranch,
  Hammer,
  Image,
  LogOut,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Users,
  Undo2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

/**
 * 全站图标：语义名 → lucide 组件。
 * 走 registry 而不是各文件直接 import，是为了尺寸、线宽、颜色只有一处定义——
 * 原来那些 unicode 字形（☰ 📁 ✕ ＋）宽度和基线各不相同，混排会歪。
 */
const ICONS = {
  back: ArrowLeft,
  /** 退出这场戏：不是「上一层」，所以不给返回箭头。 */
  exit: LogOut,
  forward: ArrowRight,
  plus: Plus,
  close: X,
  check: Check,
  alert: TriangleAlert,
  chat: MessageSquare,
  /** 回顾：这一场说过的话。刻意不与侧栏折叠键共用同一个字形。 */
  backlog: MessagesSquare,
  files: FolderOpen,
  assets: Image,
  /** 角色（工坊「角色」页）：主角卡与角色卡。 */
  users: Users,
  craft: PenLine,
  /** 记忆（工坊「设定与记忆」页）：memory/** 下的常驻设定与设定卡。 */
  memory: BookOpen,
  settings: SlidersHorizontal,
  workshop: Hammer,
  expand: Maximize2,
  /** 侧栏收/放是一对镜像图标，与「回顾」的字形不撞——同形会让两处含义混。 */
  shrink: PanelLeftClose,
  unshrink: PanelLeftOpen,
  refresh: RotateCw,
  reply: CornerUpLeft,
  /** 「回到这里」：世界线挂回目标节点，与工坊的「回复」同形不同义。 */
  return: CornerUpLeft,
  download: Download,
  pencil: Pencil,
  undo: Undo2,
  rewrite: RotateCcw,
  fork: GitBranch,
  sparkles: Sparkles,
  play: Play,
  pause: Pause,
  volume: Volume2,
  /** 与 volume 配对：总开关关掉的态。单靠一层浅底读不出开关，翻字形才不含糊。 */
  "volume-off": VolumeX,
  prev: ChevronLeft,
  down: ChevronDown,
  up: ChevronUp,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  locate: Crosshair,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** 图标本身恒为装饰：可读名由按钮的文本或 title 承担。 */
export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name];
  // display:block 不是洁癖：svg 默认 inline，基线对齐会带出下沿空隙，
  // 在 flex/grid 的方形按钮里表现为「图标看着没居中」——向上偏 2~3px。
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" style={{ display: "block" }} />;
}
