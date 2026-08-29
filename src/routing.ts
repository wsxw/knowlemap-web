// 轻量 hash 路由：把当前视图（总览/子系统地图/选中节点）编进 URL hash，
// 刷新、分享链接、浏览器前进后退都能还原位置。静态站零依赖。
import { ContentStore } from './content/contentStore'
import { OVERVIEW_ID } from './content/overviewMap'

export interface RouteState {
  mapId: string | null
  nodeId: string | null
}

/** 状态 → hash：总览 `#/overview`；子系统 `#/<mapId>`；选中节点 `#/<mapId>/<nodeId>` */
export function hashFor(mapId: string | null, nodeId: string | null): string {
  if (!mapId || mapId === OVERVIEW_ID) return '#/overview'
  return nodeId ? `#/${mapId}/${nodeId}` : `#/${mapId}`
}

/** hash → 状态：校验 id 真实存在（子系统存在、节点属于该子系统），非法回退总览 */
export function parseHash(hash: string, store: ContentStore | null): RouteState {
  if (!store) return { mapId: null, nodeId: null }
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0 || parts[0] === 'overview') return { mapId: OVERVIEW_ID, nodeId: null }
  const [mapId, nodeId] = parts
  if (!store.map(mapId)) return { mapId: OVERVIEW_ID, nodeId: null }
  if (nodeId && store.node(nodeId) && store.mapContaining(nodeId)?.id === mapId) {
    return { mapId, nodeId }
  }
  return { mapId, nodeId: null }
}
