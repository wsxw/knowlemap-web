import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { appModel, useAppState } from './useAppModel'
import Sidebar from './components/Sidebar'
import MapCanvas from './components/MapCanvas'
import NodeDetail from './components/NodeDetail'
import RewardOverlay from './components/RewardOverlay'
import {
  OVERVIEW_ID,
  OVERVIEW_ROOT_ID,
  aggregateStatus,
  buildOverviewNodes,
  moduleMasteredCount,
} from './content/overviewMap'
import { allModules, type NodeStatus } from './domain/models'

const DETAIL_WIDTH_KEY = 'knowlemap.detailWidth.v1'
const THEME_KEY = 'knowlemap.theme.v1'
const DETAIL_MIN = 380
const DETAIL_MAX = 760
const MOBILE_QUERY = '(max-width: 1080px)'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 详情栏默认宽度：随窗口宽度的固定公式（拖动前的初始值 / 双击复位的值） */
function defaultDetailWidth(): number {
  return clamp(Math.round(window.innerWidth * 0.36), 400, 560)
}

function loadDetailWidth(): number {
  const saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY))
  return saved >= DETAIL_MIN && saved <= DETAIL_MAX ? saved : defaultDetailWidth()
}

/** 根组件：桌面三栏（侧栏 | 知识地图 | 节点详情）+ 移动端单屏切换 + 奖励弹层 */
export default function App() {
  const state = useAppState()
  const isMobile = useIsMobile()
  const shellRef = useRef<HTMLDivElement>(null)
  const [detailWidth, setDetailWidth] = useState(loadDetailWidth)
  const [resizing, setResizing] = useState(false)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  // 移动端视图状态：侧栏抽屉 / 详情滑入页
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  // 主题落到 <html data-theme>，styles.css 的变量集随之整体切换
  document.documentElement.dataset.theme = theme

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'light' ? 'dark' : 'light'
      localStorage.setItem(THEME_KEY, next)
      return next
    })
  }, [])

  // 移动端：选中节点后详情滑入
  const selectedId = state.selectedNodeId
  useEffect(() => {
    if (isMobile && selectedId) setDetailOpen(true)
  }, [selectedId, isMobile])
  // 切回桌面布局时复位移动端视图状态
  useEffect(() => {
    if (!isMobile) {
      setDrawerOpen(false)
      setDetailOpen(false)
    }
  }, [isMobile])

  /** 拖动分隔条调整详情栏宽度；双击复位（仅桌面） */
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setResizing(true)
    document.body.classList.add('resizing')
    const onMove = (ev: PointerEvent) => {
      const shellRect = shellRef.current?.getBoundingClientRect()
      if (!shellRect) return
      const w = clamp(Math.round(shellRect.right - ev.clientX), DETAIL_MIN, DETAIL_MAX)
      setDetailWidth(w)
      localStorage.setItem(DETAIL_WIDTH_KEY, String(w))
    }
    const onUp = () => {
      setResizing(false)
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const resetWidth = useCallback(() => {
    const w = defaultDetailWidth()
    setDetailWidth(w)
    localStorage.setItem(DETAIL_WIDTH_KEY, String(w))
  }, [])

  const contentError = state.contentError
  const store = state.store
  const currentMap = appModel.currentMap()
  const currentNode = appModel.currentNode()
  const isOverview = state.selectedMapId === OVERVIEW_ID

  const breadcrumbSegments = useMemo(() => {
    if (isOverview) return ['英语', '学习总览']
    if (currentNode && store) return store.breadcrumbForNode(currentNode)
    if (currentMap && store) return store.breadcrumbForMap(currentMap)
    return []
  }, [isOverview, currentNode, currentMap, store])

  // 总览地图：合成节点（根「英语」+ 模块），状态/角标按真实进度推导
  const overviewNodes = useMemo(
    () => (isOverview && store ? buildOverviewNodes(store.pack) : []),
    [isOverview, store],
  )
  const overviewStatuses = useMemo(() => {
    const map = new Map<string, NodeStatus>()
    if (!isOverview || !store) return map
    for (const module of allModules(store.pack)) {
      map.set(module.id, aggregateStatus(module.subsystems.flatMap((s) => s.nodes), state.profile))
    }
    map.set(
      OVERVIEW_ROOT_ID,
      aggregateStatus(allModules(store.pack).flatMap((m) => m.subsystems.flatMap((s) => s.nodes)), state.profile),
    )
    return map
  }, [isOverview, store, state.profile])

  const currentModuleId = useMemo(
    () => (currentNode ? store?.moduleContaining(currentNode.id)?.id ?? null : null),
    [currentNode, store],
  )

  const overviewBadgeFor = useCallback(
    (node: { id: string }) => {
      if (!store) return null
      let mastered: number, total: number
      if (node.id === OVERVIEW_ROOT_ID) {
        const overall = appModel.overallProgress()
        mastered = overall.mastered
        total = overall.total
      } else {
        const module = allModules(store.pack).find((m) => m.id === node.id)
        if (!module) return null
        total = module.subsystems.flatMap((s) => s.nodes).filter((n) => !n.comingSoon).length
        mastered = moduleMasteredCount(module, state.profile)
      }
      const here = node.id === currentModuleId ? ' 📍' : ''
      return `${mastered}/${total}${here}`
    },
    [store, state.profile, currentModuleId],
  )

  // 稳定引用：仅在地图或级别筛选变化时重建数组。
  // 否则每次渲染的新数组都会让 MapCanvas 的「适配视口」副作用重新触发，
  // 把用户拖动过的地图位置重置回去。
  const filteredNodes = useMemo(
    () => (currentMap && !isOverview ? appModel.filteredNodesIn(currentMap) : []),
    [currentMap, isOverview, state.selectedLevel],
  )
  // 切换地图/级别时重置视口（对齐 Mac 版 .id() 重建语义）
  const mapKey = `${state.selectedMapId ?? 'none'}-${state.selectedLevel ?? 'all'}`

  if (contentError) {
    return <ContentErrorView message={contentError} />
  }

  return (
    <div
      ref={shellRef}
      className={`app-shell ${resizing ? 'resizing' : ''} ${drawerOpen ? 'drawer-open' : ''} ${detailOpen ? 'detail-open' : ''}`}
      style={{ '--detail-w': `${detailWidth}px` } as CSSProperties}
    >
      <aside className="sidebar-pane">
        <Sidebar onNavigate={() => setDrawerOpen(false)} />
      </aside>
      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}

      <section className="map-pane">
        <header className="map-control-bar">
          <button
            className="menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开菜单"
            title="菜单"
          >
            ☰
          </button>
          {isOverview ? (
            <>
              <span className="map-icon">🗺️</span>
              <span className="map-title">英语 · 学习总览</span>
            </>
          ) : (
            currentMap && (
              <>
                <span className="map-icon">🗺️</span>
                <span className="map-title">{store!.breadcrumbForMap(currentMap).join(' › ')}</span>
              </>
            )
          )}
          {state.selectedLevel && (
            <span className="level-chip">级别：{state.selectedLevel}</span>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
            aria-label="切换主题"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </header>
        {isOverview ? (
          <MapCanvas
            key={mapKey}
            nodes={overviewNodes}
            force
            storageKey="knowlemap.overviewLayout.v1"
            statusFor={(node) => overviewStatuses.get(node.id) ?? 'locked'}
            badgeFor={(node) => overviewBadgeFor(node)}
            activeId={currentModuleId}
            onNodeClick={(node) => {
              // 点模块 → 进入该模块的第一个子系统地图；根节点不响应
              if (node.id === OVERVIEW_ROOT_ID || !store) return
              const module = allModules(store.pack).find((m) => m.id === node.id)
              const firstMap = module?.subsystems[0]?.id
              if (firstMap) appModel.selectMap(firstMap)
            }}
          />
        ) : currentMap ? (
          <MapCanvas key={mapKey} nodes={filteredNodes} />
        ) : (
          <div className="map-empty">请从左侧选择子系统</div>
        )}
        {state.storageError && (
          <div className="storage-error">{state.storageError}</div>
        )}
      </section>

      <div
        className="col-resizer"
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
        title="拖动调整宽度，双击复位"
        aria-label="调整详情栏宽度"
      />

      <section className="detail-pane">
        <nav className="breadcrumb" aria-label="面包屑">
          <button className="mobile-back" onClick={() => setDetailOpen(false)} aria-label="返回地图">
            ‹ 返回
          </button>
          {breadcrumbSegments.length > 0 ? (
            breadcrumbSegments.map((seg, i) => (
              <span key={i} className="breadcrumb-segment">
                {i > 0 && <span className="breadcrumb-sep">›</span>}
                <span className={i === breadcrumbSegments.length - 1 ? 'primary' : 'secondary'}>
                  {seg}
                </span>
              </span>
            ))
          ) : (
            <span className="secondary">英语 · 知识地图</span>
          )}
        </nav>
        <div className="detail-body">
          {currentNode ? <NodeDetail key={currentNode.id} node={currentNode} /> : <DetailPlaceholder />}
        </div>
      </section>

      {state.reward && <RewardOverlay reward={state.reward} />}
    </div>
  )
}

function ContentErrorView({ message }: { message: string }) {
  return (
    <div className="center-placeholder">
      <div className="placeholder-icon warn">⚠️</div>
      <h2>内容包加载失败</h2>
      <p>{message}</p>
    </div>
  )
}

function DetailPlaceholder() {
  return (
    <div className="center-placeholder">
      <div className="placeholder-icon">🗺️</div>
      <h3>从地图上选择一个节点</h3>
      <p>
        点击地图中的节点开始学习：
        先看它在整体中的位置，再学习讲解，最后闯关测试点亮它。
      </p>
    </div>
  )
}
