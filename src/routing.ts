// 轻量 hash 路由：把当前视图（总览/子系统地图/级别筛选/选中节点）编进 URL hash，
// 刷新、分享链接、浏览器前进后退都能还原位置。静态站零依赖。
import { ContentStore } from './content/contentStore'
import { OVERVIEW_ID } from './content/overviewMap'
import { allNodes } from './domain/models'

export interface RouteState {
  mapId: string | null
  nodeId: string | null
  /** 级别筛选（如 "A1"/"A2"；null = 全部） */
  level: string | null
}

/** 状态 → hash。级别为可选第二段：
 *  总览 `#/overview`、`#/overview/A1`；子系统 `#/<mapId>`、`#/<mapId>/A1`、
 *  `#/<mapId>/<nodeId>`、`#/<mapId>/A1/<nodeId>` */
export function hashFor(mapId: string | null, nodeId: string | null, level: string | null = null): string {
  if (!mapId || mapId === OVERVIEW_ID) {
    return level ? `#/overview/${level}` : '#/overview'
  }
  return `#/${[mapId, level, nodeId].filter(Boolean).join('/')}`
}

/** hash → 状态：校验真实性（子系统存在、节点属于该子系统、级别在内容包中存在），非法回退 */
export function parseHash(hash: string, store: ContentStore | null): RouteState {
  if (!store) return { mapId: null, nodeId: null, level: null }
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0) return { mapId: OVERVIEW_ID, nodeId: null, level: null }

  const validLevels = new Set(allNodes(store.pack).flatMap((n) => n.level))
  const [mapId, second, third] = parts

  if (mapId === 'overview') {
    const level = second && validLevels.has(second) ? second : null
    return { mapId: OVERVIEW_ID, nodeId: null, level }
  }
  if (!store.map(mapId)) return { mapId: OVERVIEW_ID, nodeId: null, level: null }

  // 第二段是有效级别 → 第三段才是节点；否则第二段就是节点
  const level = second && validLevels.has(second) ? second : null
  const nodeId = level ? third : second
  if (nodeId && store.node(nodeId) && store.mapContaining(nodeId)?.id === mapId) {
    return { mapId, nodeId, level }
  }
  return { mapId, nodeId: null, level }
}
