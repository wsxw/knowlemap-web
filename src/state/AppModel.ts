// 全局应用模型：框架无关的外部 store，React 通过 useSyncExternalStore 订阅
// （职责与 macOS 版 KnowleMapApp/AppModel.swift 一致）
import { ContentStore, loadDefaultContent } from '../content/contentStore'
import { OVERVIEW_ID } from '../content/overviewMap'
import {
  Badge,
  ContentPack,
  KnowledgeMap,
  KnowledgeModule,  KnowledgeNode,
  LearningProfile,
  NodeProgress,
  NodeStatus,
  RewardInfo,
  allModules,
  allNodes,
  emptyProfile,
  isComingSoon,
} from '../domain/models'
import * as engine from '../domain/learningEngine'
import { loadProfile, saveProfile } from '../persistence/progressPersistence'

export interface AppState {
  /** 内容加载失败信息；null 表示已就绪 */
  contentError: string | null
  store: ContentStore | null
  profile: LearningProfile
  selectedMapId: string | null
  selectedNodeId: string | null
  /** 级别筛选（null = 全部，否则 "A1"/"A2"） */
  selectedLevel: string | null
  reward: RewardInfo | null
  storageError: string | null
}

/** 生成一次性奖励 id（弹层列表 key 用） */
function newRewardId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `reward-${Date.now()}`
}

export class AppModel {
  private state: AppState
  private listeners = new Set<() => void>()

  constructor() {
    let store: ContentStore | null = null
    let contentError: string | null = null
    try {
      store = loadDefaultContent()
    } catch (e) {
      contentError = e instanceof Error ? e.message : String(e)
    }
    const profile = contentError ? emptyProfile() : loadProfile()
    this.state = {
      contentError,
      store,
      profile,
      // 默认打开「英语」总览地图
      selectedMapId: store ? OVERVIEW_ID : null,
      selectedNodeId: null,
      selectedLevel: null,
      reward: null,
      storageError: null,
    }
  }

  // MARK: 外部 store 协议

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): AppState => this.state

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  // MARK: 内容查询

  get pack(): ContentPack | null {
    return this.state.store?.pack ?? null
  }

  currentMap(): KnowledgeMap | undefined {
    return this.state.selectedMapId ? this.state.store?.map(this.state.selectedMapId) : undefined
  }

  currentNode(): KnowledgeNode | undefined {
    return this.state.selectedNodeId ? this.state.store?.node(this.state.selectedNodeId) : undefined
  }

  node(id: string): KnowledgeNode | undefined {
    return this.state.store?.node(id)
  }

  // MARK: 进度查询（转发 LearningEngine）

  get mastered(): Set<string> {
    return engine.masteredIds(this.state.profile)
  }

  isMastered(nodeId: string): boolean {
    return this.state.profile.nodeProgress[nodeId]?.passed === true
  }

  statusOf(node: KnowledgeNode): NodeStatus {
    return engine.statusOf(node, this.state.profile)
  }

  progressOf(node: KnowledgeNode): NodeProgress {
    return this.state.profile.nodeProgress[node.id] ?? {
      attempts: 0, bestCorrect: 0, totalQuestions: 0, passed: false, lastStudiedAt: null,
    }
  }

  /** 整张主题（全部已上线节点）进度 */
  overallProgress(): { mastered: number; total: number } {
    const pack = this.pack
    if (!pack) return { mastered: 0, total: 0 }
    return progressOver(
      allNodes(pack).filter((n) => !isComingSoon(n)),
      (id) => this.isMastered(id),
    )
  }

  progressOfMap(map: KnowledgeMap): { mastered: number; total: number } {
    return progressOver(map.nodes.filter((n) => !isComingSoon(n)), (id) => this.isMastered(id))
  }

  progressOfModule(module: KnowledgeModule): { mastered: number; total: number } {
    return progressOver(
      module.subsystems.flatMap((s) => s.nodes).filter((n) => !isComingSoon(n)),
      (id) => this.isMastered(id),
    )
  }

  // MARK: 级别筛选

  levelOptions(): string[] {
    const pack = this.pack
    if (!pack) return []
    const set = new Set<string>()
    for (const node of allNodes(pack)) for (const lv of node.level) set.add(lv)
    return [...set].sort()
  }

  filteredNodesIn(map: KnowledgeMap): KnowledgeNode[] {
    if (!this.state.selectedLevel) return map.nodes
    return map.nodes.filter((n) => n.level.includes(this.state.selectedLevel!))
  }

  // MARK: 游戏化查询

  get xpLevel(): number {
    return engine.level(this.state.profile.xp)
  }

  get levelProgress(): number {
    return engine.levelProgress(this.state.profile.xp)
  }

  earnedBadges(): Badge[] {
    const ids = new Set(this.state.profile.badges)
    return engine.badgeCatalog.filter((b) => ids.has(b.id))
  }

  get allBadges(): Badge[] {
    return engine.badgeCatalog
  }

  // MARK: 交互

  selectMap(mapId: string) {
    // 切地图时，若当前选中节点不属于新地图则清空
    const keep =
      this.state.selectedNodeId && this.state.store?.mapContaining(this.state.selectedNodeId)?.id === mapId
    this.set({
      selectedMapId: mapId,
      selectedNodeId: keep ? this.state.selectedNodeId : null,
    })
  }

  /** 切到「英语」总览地图（保留节点选中态，供总览标注当前位置） */
  selectOverview() {
    this.set({ selectedMapId: OVERVIEW_ID })
  }

  /** 从 URL 路由还原视图（刷新/前进/后退/分享链接），不产生新的历史记录 */
  restoreFromRoute(route: { mapId: string | null; nodeId: string | null }) {
    this.set({
      selectedMapId: route.mapId ?? OVERVIEW_ID,
      selectedNodeId: route.nodeId,
    })
  }

  selectNode(nodeId: string | null) {
    // 联动：选中节点时切到它所在的地图；占位节点也允许查看
    const mapId = nodeId ? this.state.store?.mapContaining(nodeId)?.id ?? null : null
    this.set({ selectedNodeId: nodeId, selectedMapId: mapId ?? this.state.selectedMapId })
  }

  selectLevel(level: string | null) {
    this.set({ selectedLevel: level })
  }

  dismissReward() {
    this.set({ reward: null })
  }

  /** 清空全部进度并重开档案（Web 版新增，便于演示/教学） */
  resetProgress() {
    this.set({ profile: emptyProfile(), reward: null, storageError: null, selectedNodeId: null })
    try {
      saveProfile(emptyProfile())
    } catch {
      /* 存储不可用时仅内存内重置 */
    }
  }

  // MARK: 闯关结算

  /**
   * 测试完成后调用：更新档案、发 XP（仅首次通关）、结算徽章与解锁、持久化。
   * 返回是否通关。
   */
  finishQuiz(node: KnowledgeNode, correct: number): boolean {
    const total = node.quiz.questions.length
    const threshold = node.quiz.passThreshold
    const passed = engine.isPassed(correct, total, threshold)

    const previous = this.state.profile.nodeProgress[node.id] ?? {
      attempts: 0, bestCorrect: 0, totalQuestions: 0, passed: false, lastStudiedAt: null,
    }
    const wasMastered = previous.passed
    const newProgress: NodeProgress = {
      attempts: previous.attempts + 1,
      totalQuestions: total,
      bestCorrect: Math.max(previous.bestCorrect, correct),
      lastStudiedAt: new Date().toISOString(),
      passed: previous.passed || passed,
    }
    const profile = {
      ...this.state.profile,
      nodeProgress: { ...this.state.profile.nodeProgress, [node.id]: newProgress },
    }
    this.set({ profile })

    if (passed && !wasMastered) {
      // XP 只在首次通关发放（防刷分）
      const xpGained = engine.XP_PER_PASS
      const afterXp = { ...profile, xp: profile.xp + xpGained }

      // 结算徽章
      const oldBadgeIds = new Set(profile.badges)
      const shouldEarn = engine.evaluateBadges(afterXp, this.pack!)
      const newBadges = shouldEarn.filter((b) => !oldBadgeIds.has(b.id))

      // 本次通关新解锁的节点
      const masteredNow = engine.masteredIds(afterXp)
      const unlockedTitles = (this.state.store?.downstream(node.id) ?? [])
        .filter((n) => !masteredNow.has(n.id))
        .map((n) => n.title)

      this.set({
        profile: { ...afterXp, badges: shouldEarn.map((b) => b.id) },
        reward: {
          id: newRewardId(),
          xpGained,
          newBadges,
          unlockedNodeTitles: unlockedTitles,
        },
      })
    }

    this.persist()
    return passed
  }

  // MARK: 持久化

  private persist() {
    try {
      saveProfile(this.state.profile)
      if (this.state.storageError) this.set({ storageError: null })
    } catch (e) {
      this.set({ storageError: `进度保存失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }
}

function progressOver(nodes: KnowledgeNode[], isMastered: (id: string) => boolean) {
  const mastered = nodes.filter((n) => isMastered(n.id)).length
  return { mastered, total: nodes.length }
}

/** 模块枚举便捷导出（侧栏用） */
export function modulesOf(model: AppModel): KnowledgeModule[] {
  const pack = model.pack
  return pack ? allModules(pack) : []
}
