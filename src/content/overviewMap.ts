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

/** 总览初始坐标：英语居中、模块环绕——力导向模拟从这个对称起点收敛成网状 */
const OVERVIEW_LAYOUT: Record<string, Point2> = (() => {
  const layout: Record<string, Point2> = { [OVERVIEW_ROOT_ID]: { x: 420, y: 300 } }
  const moduleIds = ['grammar', 'vocabulary', 'pronunciation', 'functions', 'discourse', 'skills']
  const radius = 190
  moduleIds.forEach((id, i) => {
    const angle = (Math.PI * 2 * i) / moduleIds.length - Math.PI / 2 // 第一个从正上方开始
    layout[id] = {
      x: Math.round(420 + radius * Math.cos(angle)),
      y: Math.round(300 + radius * Math.sin(angle)),
    }
  })
  return layout
})()

function layoutFor(id: string, index: number): Point2 {
  return OVERVIEW_LAYOUT[id] ?? { x: 400, y: 120 + index * 110 }
}

/** 跨模块前置聚合：模块 A 的节点是模块 B 节点的前置 → B 的入边集合里记 A（B→A 查询） */
function crossModuleEdges(pack: ContentPack): Map<string, Set<string>> {
  const moduleOf = new Map<string, string>()
  for (const module of allModules(pack)) {
    for (const s of module.subsystems) {
      for (const n of s.nodes) moduleOf.set(n.id, module.id)
    }
  }
  const incoming = new Map<string, Set<string>>()
  for (const module of allModules(pack)) {
    for (const s of module.subsystems) {
      for (const n of s.nodes) {
        const targetModule = moduleOf.get(n.id)!
        for (const pre of n.prerequisites) {
          const preModule = moduleOf.get(pre)
          if (preModule && preModule !== targetModule) {
            if (!incoming.has(targetModule)) incoming.set(targetModule, new Set())
            incoming.get(targetModule)!.add(preModule)
          }
        }
      }
    }
  }
  return incoming
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

/** 构建总览节点：根「英语」扇出指向全部模块，另叠加真实跨模块前置边 */
export function buildOverviewNodes(pack: ContentPack): KnowledgeNode[] {
  const edges = crossModuleEdges(pack)
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
    // 从主题根扇出 + 真实跨模块前置（如 语法→功能→技能）
    prerequisites: [OVERVIEW_ROOT_ID, ...(edges.get(module.id) ?? [])],
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
