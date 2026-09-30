import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  CornerUpLeft,
  Crosshair,
  Download,
  FolderOpen,
  GitBranch,
  Hammer,
  Image,
  List,
  LocateFixed,
  LogOut,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  Minus,
  Minimize2,
  PanelLeftClose,
  Pause,
  Pencil,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
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
  forward: ArrowRight,
  plus: Plus,
  minus: Minus,
  close: X,
  check: Check,
  alert: TriangleAlert,
  menu: List,
  chat: MessageSquare,
  files: FolderOpen,
  assets: Image,
  craft: PenLine,
  settings: SlidersHorizontal,
  workshop: Hammer,
  exit: LogOut,
  expand: Maximize2,
  collapse: Minimize2,
  shrink: PanelLeftClose,
  refresh: RotateCw,
  reply: CornerUpLeft,
  /** 「回到这里」：世界线挂回目标节点，与工坊的「回复」同形不同义。 */
  return: CornerUpLeft,
  download: Download,
  pencil: Pencil,
  undo: Undo2,
  rewrite: RotateCcw,
  fork: GitBranch,
  ooc: MessagesSquare,
  sparkles: Sparkles,
  play: Play,
  pause: Pause,
  volume: Volume2,
  mute: VolumeX,
  prev: ChevronLeft,
  down: ChevronDown,
  save: Save,
  trash: Trash2,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  origin: LocateFixed,
  locate: Crosshair,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** 图标本身恒为装饰：可读名由按钮的文本或 title 承担。 */
export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" />;
}
