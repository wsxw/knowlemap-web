import { appModel, useAppState } from '../useAppModel'
import { modulesOf } from '../state/AppModel'
import * as engine from '../domain/learningEngine'
import { AnimatedNumber } from '@/components/motion/animated-number'

/** 侧栏：主题总进度、级别筛选、模块 → 子系统导航、成长数据 */
export default function Sidebar() {
  const state = useAppState()
  const overall = appModel.overallProgress()
  const modules = modulesOf(appModel)

  return (
    <div className="sidebar">
      <h1 className="sidebar-title">知识地图</h1>

      {/* 学习主题总进度 */}
      <section className="side-section">
        <div className="section-header">学习主题</div>
        <div className="theme-row">
          <span className="theme-name">🇬🇧 英语</span>
          <span className="level-chip">A1–A2</span>
        </div>
        <ProgressBar value={engine.overallProgress(overall.mastered, overall.total)} />
        <div className="caption">
          已点亮 {overall.mastered} / {overall.total} 个节点
        </div>
      </section>

      {/* 级别筛选 */}
      <section className="side-section">
        <div className="section-header">级别</div>
        <div className="chip-row">
          <button
            className={`chip ${state.selectedLevel === null ? 'active' : ''}`}
            onClick={() => appModel.selectLevel(null)}
          >
            全部
          </button>
          {appModel.levelOptions().map((level) => (
            <button
              key={level}
              className={`chip ${state.selectedLevel === level ? 'active' : ''}`}
              onClick={() => appModel.selectLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>
      </section>

      {/* 模块 → 子系统 */}
      {modules.map((module) => {
        const p = appModel.progressOfModule(module)
        return (
          <section className="side-section" key={module.id}>
            <div className="section-header">
              {module.name} · {p.mastered}/{p.total}
            </div>
            {module.subsystems.map((map) => {
              const mp = appModel.progressOfMap(map)
              const selected = state.selectedMapId === map.id
              return (
                <button
                  key={map.id}
                  className={`map-row ${selected ? 'active' : ''}`}
                  onClick={() => appModel.selectMap(map.id)}
                >
                  <span className={`map-ico ${selected ? 'on' : ''}`}>🗺️</span>
                  <span className="map-name">{map.name}</span>
                  <span className="caption">
                    {mp.total > 0 ? `${mp.mastered}/${mp.total}` : '待上线'}
                  </span>
                </button>
              )
            })}
          </section>
        )
      })}

      {/* 成长数据 */}
      <section className="side-section">
        <div className="section-header">我的成长</div>
        <div className="xp-row">
          <strong>Lv.{appModel.xpLevel}</strong>
          <span className="caption mono">
            <AnimatedNumber value={state.profile.xp} startOnView={false} /> XP
          </span>
        </div>
        <ProgressBar value={appModel.levelProgress} />
        <div className="caption">
          {(() => {
            const rest = engine.xpToNextLevel(state.profile.xp)
            return rest === 0 ? '已抵达下一级，继续加油！' : `再得 ${rest} XP 升级`
          })()}
        </div>
        <div className="badge-list">
          {appModel.allBadges.map((badge) => {
            const earned = state.profile.badges.includes(badge.id)
            return (
              <div key={badge.id} className={`badge-row ${earned ? 'earned' : 'unearned'}`}>
                <span className="badge-icon">{badge.icon}</span>
                <span>
                  <span className="badge-name">{badge.name}</span>
                  <span className="caption block">{badge.description}</span>
                </span>
              </div>
            )
          })}
        </div>
        <button className="reset-btn" onClick={() => appModel.resetProgress()}>
          清空进度（重新开始）
        </button>
      </section>
    </div>
  )
}

/** 通用进度条（value=0 时不再显示 Mac 版的 8px 存根） */
export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track">
      <div
        className="progress-fill"
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}
      />
    </div>
  )
}
