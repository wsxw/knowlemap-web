// 「英语」总览地图：主题根节点 + 各模块节点组成的知识全景图。
// 布局与边在此静态构建；节点状态/角标由渲染层按真实进度推导。
import {
  ContentPack,
  KnowledgeModule,
  KnowledgeNode,
  LearningProfile,
  NodeStatus,
  Point2,
  allModules,
  isComingSoon,
} from '../domain/models'
import * as engine from '../domain/learningEngine'

export const OVERVIEW_ID = 'overview'
export const OVERVIEW_ROOT_ID = 'en'

/** 总览树形布局：「英语」在底部，模块按重要关系向上生长（像一棵树）：
 *  根上一层是地基三科（语法/词汇/发音），其上是功能（用语法的句子表达意思），
 *  顶端是语篇与技能（组句成篇、综合听说读写能力）。y 向上为负。 */
const OVERVIEW_TREE: Record<string, { parent: string; x: number; y: number }> = {
  grammar: { parent: OVERVIEW_ROOT_ID, x: -210, y: -175 },
  vocabulary: { parent: OVERVIEW_ROOT_ID, x: 0, y: -175 },
  pronunciation: { parent: OVERVIEW_ROOT_ID, x: 210, y: -175 },
  functions: { parent: 'grammar', x: 0, y: -350 },
  discourse: { parent: 'functions', x: -130, y: -525 },
  skills: { parent: 'functions', x: 130, y: -525 },
}

const ROOT_POS: Point2 = { x: 0, y: 0 }

function treeEntryFor(id: string, index: number): { parent: string; pos: Point2 } {
  const entry = OVERVIEW_TREE[id]
  if (entry) return { parent: entry.parent, pos: { x: entry.x, y: entry.y } }
  // 未收录的模块兜底：英语直连，顶部一行依次排开
  return { parent: OVERVIEW_ROOT_ID, pos: { x: -200 + (index % 5) * 100, y: -700 } }
}

function layoutFor(id: string, index: number): Point2 {
  if (id === OVERVIEW_ROOT_ID) return { ...ROOT_POS }
  return treeEntryFor(id, index).pos
}

function dummyExtras(): Pick<KnowledgeNode, 'organizer' | 'explanation' | 'activity' | 'quiz' | 'related'> {
  return {
    organizer: '',
    explanation: [],
    activity: { type: 'freeWrite', prompt: '', sampleAnswer: '' },
    quiz: { passThreshold: 1, questions: [] },
    related: [],
  }
}

/** 构建总览节点：树形结构，每个模块一个父节点（根「英语」在最底部） */
export function buildOverviewNodes(pack: ContentPack): KnowledgeNode[] {
  const rootNode: KnowledgeNode = {
    id: OVERVIEW_ROOT_ID,
    title: '🇬🇧 英语',
    level: [],
    prerequisites: [],
    layout: layoutFor(OVERVIEW_ROOT_ID, -1),
    ...dummyExtras(),
  }
  const moduleNodes = allModules(pack).map((module, i): KnowledgeNode => ({
    id: module.id,
    title: module.name,
    level: [],
    // 树形：单一父节点（英语扇出到地基三科，其上按 语法→功能→语篇/技能 生长）
    prerequisites: [treeEntryFor(module.id, i).parent],
    layout: layoutFor(module.id, i),
    ...dummyExtras(),
  }))
  return [rootNode, ...moduleNodes]
}

/** 模块（或整张主题）的聚合状态：全点亮=已掌握，部分点亮/有进行中=进行中，有可学=可学习，全锁=未解锁 */
export function aggregateStatus(nodes: KnowledgeNode[], profile: LearningProfile): NodeStatus {
  const study = nodes.filter((n) => !isComingSoon(n))
  if (study.length === 0) return 'comingSoon'
  const masteredCount = study.filter((n) => profile.nodeProgress[n.id]?.passed).length
  if (masteredCount === study.length) return 'mastered'
  const anyStarted = study.some((n) => (profile.nodeProgress[n.id]?.attempts ?? 0) > 0)
  if (masteredCount > 0 || anyStarted) return 'inProgress'
  const anyAvailable = study.some((n) => engine.statusOf(n, profile) === 'available')
  return anyAvailable ? 'available' : 'locked'
}

/** 模块点亮计数 */
export function moduleMasteredCount(module: KnowledgeModule, profile: LearningProfile): number {
  return module.subsystems
    .flatMap((s) => s.nodes)
    .filter((n) => !isComingSoon(n) && profile.nodeProgress[n.id]?.passed).length
}
