// 内容仓库：解析内容包 + 建索引 + 校验（对齐 macOS 版 ContentKit/ContentStore.swift）
import rawContent from '../data/content.json'
import {
  ContentPack,
  KnowledgeMap,
  KnowledgeModule,
  KnowledgeNode,
  allMaps,
  allModules,
  allNodes,
  isComingSoon,
} from '../domain/models'

export interface ValidationIssue {
  message: string
}

// MARK: 校验

function validate(pack: ContentPack, nodeIndex: Map<string, KnowledgeNode>): string[] {
  const issues: string[] = []
  for (const map of allMaps(pack)) {
    if (map.nodes.length === 0) {
      issues.push(`子系统「${map.name}」没有任何节点`)
      continue
    }
    for (const node of map.nodes) {
      for (const pre of node.prerequisites) {
        if (!nodeIndex.has(pre)) issues.push(`节点「${node.title}」的前置节点不存在：${pre}`)
      }
      for (const rel of node.related) {
        if (!nodeIndex.has(rel)) issues.push(`节点「${node.title}」的关联节点不存在：${rel}`)
      }
      if (isComingSoon(node)) continue // 占位节点无需题目
      if (node.quiz.questions.length === 0) {
        issues.push(`节点「${node.title}」没有测试题`)
      }
      node.quiz.questions.forEach((q, i) => {
        if (q.type === 'choice') {
          const ok =
            Array.isArray(q.options) &&
            q.options.length >= 2 &&
            q.answerIndex !== undefined &&
            q.answerIndex >= 0 &&
            q.answerIndex < q.options.length
          if (!ok) issues.push(`节点「${node.title}」第 ${i + 1} 题选择题配置不完整`)
        } else if (!q.answerText) {
          issues.push(`节点「${node.title}」第 ${i + 1} 题填空题缺少答案`)
        }
      })
    }
  }
  return issues
}

// MARK: 内容仓库

export class ContentStore {
  readonly pack: ContentPack
  private nodeIndex: Map<string, KnowledgeNode>
  private mapIndex: Map<string, KnowledgeMap>
  private moduleIndex: Map<string, KnowledgeModule>
  private nodeToMap: Map<string, KnowledgeMap>
  private nodeToModule: Map<string, KnowledgeModule>

  private constructor(pack: ContentPack) {
    this.pack = pack
    this.nodeIndex = new Map()
    this.mapIndex = new Map()
    this.moduleIndex = new Map()
    this.nodeToMap = new Map()
    this.nodeToModule = new Map()
    for (const domain of pack.domains) {
      for (const module of domain.modules) {
        this.moduleIndex.set(module.id, module)
        for (const map of module.subsystems) {
          this.mapIndex.set(map.id, map)
          for (const node of map.nodes) {
            this.nodeIndex.set(node.id, node)
            this.nodeToMap.set(node.id, map)
            this.nodeToModule.set(node.id, module)
          }
        }
      }
    }
    const issues = validate(pack, this.nodeIndex)
    if (issues.length > 0) {
      throw new Error('内容包校验失败：\n' + issues.join('\n'))
    }
  }

  /** 从 JSON 数据构建（对齐 Swift 的 init(data:)），失败抛错 */
  static create(data: unknown): ContentStore {
    const pack = data as ContentPack
    if (typeof pack?.schemaVersion !== 'number' || !Array.isArray(pack?.domains)) {
      throw new Error('内容包解析失败：缺少 schemaVersion 或 domains 字段')
    }
    return new ContentStore(pack)
  }

  // MARK: 查询

  node(id: string): KnowledgeNode | undefined {
    return this.nodeIndex.get(id)
  }

  map(id: string): KnowledgeMap | undefined {
    return this.mapIndex.get(id)
  }

  module(id: string): KnowledgeModule | undefined {
    return this.moduleIndex.get(id)
  }

  mapContaining(nodeId: string): KnowledgeMap | undefined {
    return this.nodeToMap.get(nodeId)
  }

  /** 直接下游节点（以 nodeId 为前置的节点，含跨模块） */
  downstream(nodeId: string): KnowledgeNode[] {
    return allNodes(this.pack).filter((n) => n.prerequisites.includes(nodeId))
  }

  /** 面包屑：主题 → 模块 → 子系统 */
  breadcrumbForMap(map: KnowledgeMap): string[] {
    const moduleName = this.nodeToModuleName(map)
    const parts: string[] = [domainNameFor(this.pack, map.id)].filter((x): x is string => !!x)
    if (moduleName) parts.push(moduleName)
    parts.push(map.name)
    return parts
  }

  /** 完整面包屑：主题 → 模块 → 子系统 → 节点标题 */
  breadcrumbForNode(node: KnowledgeNode): string[] {
    const map = this.nodeToMap.get(node.id)
    if (!map) return [node.title]
    return [...this.breadcrumbForMap(map), node.title]
  }

  private nodeToModuleName(map: KnowledgeMap): string | undefined {
    for (const module of allModules(this.pack)) {
      if (module.subsystems.some((s) => s.id === map.id)) return module.name
    }
    return undefined
  }
}

function domainNameFor(pack: ContentPack, mapId: string): string | undefined {
  for (const domain of pack.domains) {
    if (domain.modules.some((m) => m.subsystems.some((s) => s.id === mapId))) {
      return domain.name
    }
  }
  return undefined
}

/** 应用默认内容包（打包进 bundle 的 content.json），与 Mac 版同一份数据源 */
export function loadDefaultContent(): ContentStore {
  return ContentStore.create(rawContent)
}
