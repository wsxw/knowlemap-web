// 内容包 + 学习进度模型（平台无关，逐行对齐 macOS 版 CoreDomain/Models.swift）

// MARK: - 内容包模型

export interface ContentPack {
  schemaVersion: number
  domains: Domain[]
}

export interface Domain {
  id: string
  name: string
  modules: KnowledgeModule[]
}

/** 模块（如「语法」「词汇」） */
export interface KnowledgeModule {
  id: string
  name: string
  subsystems: KnowledgeMap[]
}

/** 子系统（如「时态系统」），地图视图的基本单位 */
export interface KnowledgeMap {
  id: string
  name: string
  nodes: KnowledgeNode[]
}

/** 知识节点：地图上的一个「关卡」 */
export interface KnowledgeNode {
  id: string
  title: string
  /** 难度级别（如 ["A1"] / ["A1", "A2"]） */
  level: string[]
  /** 「待上线」占位节点标记 */
  comingSoon?: boolean
  /** 先行组织者：讲清该知识在整体中的位置 */
  organizer: string
  explanation: ContentBlock[]
  activity: Activity
  quiz: Quiz
  /** 前置节点 id（全部掌握后本节点解锁） */
  prerequisites: string[]
  /** 关联节点 id */
  related: string[]
  /** 内容包内置的预计算布局坐标（子系统内局部坐标） */
  layout: Point2
}

export interface ContentBlock {
  type: 'text' | 'examples' | 'tip' | string
  text?: string
  items?: string[]
}

export interface Activity {
  type: 'freeWrite' | string
  prompt: string
  sampleAnswer: string
}

export interface Quiz {
  passThreshold: number
  questions: Question[]
}

export interface Question {
  type: 'choice' | 'fillIn' | string
  prompt: string
  options?: string[]
  answerIndex?: number
  answerText?: string
  explanation: string
}

/** 平台无关坐标 */
export interface Point2 {
  x: number
  y: number
}

// —— 派生查询（对应 Swift 计算属性） ——

export function allModules(pack: ContentPack): KnowledgeModule[] {
  return pack.domains.flatMap((d) => d.modules)
}

export function allMaps(pack: ContentPack): KnowledgeMap[] {
  return allModules(pack).flatMap((m) => m.subsystems)
}

export function allNodes(pack: ContentPack): KnowledgeNode[] {
  return allMaps(pack).flatMap((m) => m.nodes)
}

export function isComingSoon(node: KnowledgeNode): boolean {
  return node.comingSoon === true
}

/** 已上线（可学习）节点 */
export function studyableNodes(pack: ContentPack): KnowledgeNode[] {
  return allNodes(pack).filter((n) => !isComingSoon(n))
}

// MARK: - 学习进度模型

/** 单节点学习状态：只持久化事实，状态由规则推导 */
export interface NodeProgress {
  attempts: number
  bestCorrect: number
  totalQuestions: number
  passed: boolean
  lastStudiedAt: string | null // ISO8601
}

export function emptyProgress(): NodeProgress {
  return { attempts: 0, bestCorrect: 0, totalQuestions: 0, passed: false, lastStudiedAt: null }
}

export function masteryScore(p: NodeProgress): number {
  if (p.totalQuestions <= 0) return 0
  return p.bestCorrect / p.totalQuestions
}

export function progressStarted(p: NodeProgress): boolean {
  return p.attempts > 0
}

/** 用户学习档案 */
export interface LearningProfile {
  xp: number
  badges: string[]
  nodeProgress: Record<string, NodeProgress>
}

export function emptyProfile(): LearningProfile {
  return { xp: 0, badges: [], nodeProgress: {} }
}

/** 地图节点显示状态（由规则推导，不持久化） */
export type NodeStatus = 'locked' | 'available' | 'inProgress' | 'mastered' | 'comingSoon'

// MARK: - 游戏化

export interface Badge {
  id: string
  name: string
  icon: string
  description: string
}

/** 通关奖励信息（奖励弹层展示用） */
export interface RewardInfo {
  id: string
  xpGained: number
  newBadges: Badge[]
  unlockedNodeTitles: string[]
}
