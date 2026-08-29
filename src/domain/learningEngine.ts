// 学习规则引擎：纯函数、无副作用（对齐 macOS 版 CoreDomain/LearningEngine.swift）
import {
  Badge,
  ContentPack,
  KnowledgeNode,
  LearningProfile,
  NodeStatus,
  allMaps,
  allModules,
  isComingSoon,
  studyableNodes,
} from './models'

// MARK: 常量

export const XP_PER_PASS = 50
export const XP_PER_LEVEL = 100

// MARK: 解锁规则

/** 前置节点全部掌握 → 解锁 */
export function isUnlocked(node: KnowledgeNode, mastered: Set<string>): boolean {
  return node.prerequisites.every((p) => mastered.has(p))
}

export function masteredIds(profile: LearningProfile): Set<string> {
  return new Set(
    Object.entries(profile.nodeProgress)
      .filter(([, p]) => p.passed)
      .map(([id]) => id),
  )
}

// MARK: 通关判定

export function isPassed(correct: number, total: number, threshold: number): boolean {
  if (total <= 0) return false
  return correct / total >= threshold
}

export function masteryScoreOf(correct: number, total: number): number {
  if (total <= 0) return 0
  return correct / total
}

// MARK: 进度

export function overallProgress(masteredCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0
  return masteredCount / totalCount
}

// MARK: 等级

export function level(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1
}

export function levelProgress(xp: number): number {
  return (xp % XP_PER_LEVEL) / XP_PER_LEVEL
}

/** 距下一级还差的 XP（恰在等级边界时为 0） */
export function xpToNextLevel(xp: number): number {
  return XP_PER_LEVEL - (xp % XP_PER_LEVEL)
}

// MARK: 节点显示状态

export function statusOf(node: KnowledgeNode, profile: LearningProfile): NodeStatus {
  if (isComingSoon(node)) return 'comingSoon'
  const mastered = masteredIds(profile)
  const p = profile.nodeProgress[node.id]
  if (p) {
    if (p.passed) return 'mastered'
    if (p.attempts > 0) return 'inProgress'
  }
  return isUnlocked(node, mastered) ? 'available' : 'locked'
}

// MARK: 徽章

export const badgeCatalog: Badge[] = [
  { id: 'first-light', name: '点亮地图', icon: '💡', description: '掌握第一个知识节点' },
  { id: 'tense-explorer', name: '时态探索者', icon: '🧭', description: '掌握时态系统前三个节点' },
  { id: 'tense-conqueror', name: '时态征服者', icon: '⏳', description: '掌握时态系统全部节点' },
  { id: 'grammar-master', name: '语法大师', icon: '🧩', description: '掌握语法模块全部已上线节点' },
  { id: 'a1-master', name: 'A1 大师', icon: '🏆', description: '点亮全部已上线的 A1 节点' },
  { id: 'b1-master', name: 'B1 大师', icon: '🥇', description: '点亮全部已上线的 B1 节点' },
  { id: 'b2-master', name: 'B2 大师', icon: '🛡️', description: '点亮全部已上线的 B2 节点' },
  { id: 'c1-master', name: 'C1 大师', icon: '🎯', description: '点亮全部已上线的 C1 节点' },
  { id: 'c2-master', name: 'C2 大师', icon: '👑', description: '点亮全部已上线的 C2 节点' },
]

/** 级别大师徽章：点亮该级别全部已上线节点 */
const LEVEL_BADGES: { id: string; level: string }[] = [
  { id: 'a1-master', level: 'A1' },
  { id: 'b1-master', level: 'B1' },
  { id: 'b2-master', level: 'B2' },
  { id: 'c1-master', level: 'C1' },
  { id: 'c2-master', level: 'C2' },
]

function badge(id: string): Badge {
  const b = badgeCatalog.find((x) => x.id === id)
  if (!b) throw new Error(`未知徽章：${id}`)
  return b
}

/** 根据当前档案计算应得的全部徽章（幂等，调用方负责 diff 出新获得项） */
export function evaluateBadges(profile: LearningProfile, pack: ContentPack): Badge[] {
  const mastered = masteredIds(profile)
  if (mastered.size === 0) return []
  const earned: Badge[] = []

  earned.push(badge('first-light'))

  const starterIds = ['tense_overview', 'be_present', 'present_simple']
  if (starterIds.every((id) => mastered.has(id))) {
    earned.push(badge('tense-explorer'))
  }

  const tenseMap = allMaps(pack).find((m) => m.id === 'tense_system')
  if (tenseMap && tenseMap.nodes.length > 0 && tenseMap.nodes.every((n) => mastered.has(n.id))) {
    earned.push(badge('tense-conqueror'))
  }

  const grammar = allModules(pack).find((m) => m.id === 'grammar')
  if (grammar) {
    const ids = grammar.subsystems.flatMap((s) => s.nodes).filter((n) => !isComingSoon(n)).map((n) => n.id)
    if (ids.length > 0 && ids.every((id) => mastered.has(id))) {
      earned.push(badge('grammar-master'))
    }
  }

  // 级别大师徽章：点亮该级别全部已上线节点（A1–C2 循环判定）
  for (const { id, level } of LEVEL_BADGES) {
    const levelIds = studyableNodes(pack).filter((n) => n.level.includes(level)).map((n) => n.id)
    if (levelIds.length > 0 && levelIds.every((nid) => mastered.has(nid))) {
      earned.push(badge(id))
    }
  }

  return earned
}

// MARK: 路径推荐

/** 通关当前节点后推荐：以当前节点为前置、已解锁且未掌握的可学习节点 */
export function nextRecommendations(
  current: KnowledgeNode,
  pack: ContentPack,
  mastered: Set<string>,
): KnowledgeNode[] {
  return studyableNodes(pack).filter(
    (n) =>
      n.id !== current.id &&
      n.prerequisites.includes(current.id) &&
      !mastered.has(n.id) &&
      isUnlocked(n, mastered),
  )
}

// MARK: 填空题答案判定（宽松归一化：忽略首尾空白/大小写/末尾句点）

function normalize(s: string): string {
  let t = s.trim().toLowerCase()
  while (t.endsWith('.')) t = t.slice(0, -1)
  return t
}

export function isFillInAnswerCorrect(input: string, answer: string): boolean {
  return normalize(input) === normalize(answer)
}
