import { useState } from 'react'
import { ContentBlock, KnowledgeNode } from '../domain/models'
import { appModel, useAppState } from '../useAppModel'
import QuizView from './QuizView'

/** 节点学习页：先行组织者 → 讲解 → 练习活动 → 闯关测试入口 */
export default function NodeDetail({ node }: { node: KnowledgeNode }) {
  useAppState()
  const [showQuiz, setShowQuiz] = useState(false)
  const [activityText, setActivityText] = useState('')

  if (showQuiz) {
    return <QuizView node={node} onExit={() => setShowQuiz(false)} />
  }

  const status = appModel.statusOf(node)
  const progress = appModel.progressOf(node)
  const store = appModel.getSnapshot().store

  return (
    <div className="detail-scroll">
      <div className="detail-inner">
        {/* 头部 */}
        <header className="node-header">
          <h2>
            {node.title}
            {node.level[0] && <span className="level-chip">{node.level[0]}</span>}
          </h2>
          <div className="status-line">
            {status === 'mastered' && (
              <span className="status-text green">
                ✔ 已掌握 · 最佳成绩 {progress.bestCorrect}/{progress.totalQuestions}
              </span>
            )}
            {status === 'inProgress' && (
              <span className="status-text orange">
                ⏳ 进行中 · 最佳成绩 {progress.bestCorrect}/{progress.totalQuestions}
              </span>
            )}
            {status === 'available' && <span className="status-text blue">✨ 已解锁，开始学习吧</span>}
            {status === 'locked' && <span className="status-text secondary">🔒 未解锁 · 需先掌握前置节点</span>}
            {status === 'comingSoon' && <span className="status-text secondary">⏳ 内容待上线</span>}
            {progress.attempts > 0 && (
              <span className="caption">已挑战 {progress.attempts} 次</span>
            )}
          </div>
        </header>

        {node.comingSoon ? (
          <ComingSoonCard organizer={node.organizer} />
        ) : (
          <>
            {status === 'locked' && <LockedBanner node={node} />}

            {/* 先行组织者 */}
            <section className="card organizer-card">
              <h3>🧭 这个知识在整张图中的位置</h3>
              {store && (
                <div className="caption breadcrumb-inline">{store.breadcrumbForNode(node).join(' › ')}</div>
              )}
              <p>{node.organizer}</p>
            </section>

            {/* 讲解 */}
            <section className="explain-section">
              <h3>📖 讲解</h3>
              {node.explanation.map((block, i) => (
                <ContentBlockView key={i} block={block} />
              ))}
            </section>

            {/* 练习活动 */}
            <section className="card activity-card">
              <h3>✍️ 练习：用自己的话写一写</h3>
              <p>{node.activity.prompt}</p>
              <textarea
                value={activityText}
                onChange={(e) => setActivityText(e.target.value)}
                placeholder="在这里写下你的答案……"
                rows={4}
              />
              <details>
                <summary>查看参考示例</summary>
                <p className="caption">{node.activity.sampleAnswer}</p>
              </details>
            </section>

            {/* 闯关测试入口 */}
            <section className="card quiz-entry-card">
              <h3>⚔️ 闯关测试</h3>
              <p className="caption">
                {node.quiz.questions.length} 道题，正确率 ≥ {Math.round(node.quiz.passThreshold * 100)}%
                通关，点亮本节点并获得 XP。
              </p>
              <button
                className="primary-btn"
                disabled={status === 'locked'}
                onClick={() => setShowQuiz(true)}
              >
                🏁 {status === 'mastered' ? '重新挑战' : progress.attempts > 0 ? '再次挑战' : '开始闯关测试'}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function ComingSoonCard({ organizer }: { organizer: string }) {
  return (
    <section className="card coming-soon-card">
      <h3>🔨 这个节点还在建设中</h3>
      <p className="secondary">{organizer}</p>
      <p className="caption">讲解与练习将在后续版本补充。你可以先去学习其它已上线节点。</p>
    </section>
  )
}

function LockedBanner({ node }: { node: KnowledgeNode }) {
  const missing = node.prerequisites
    .filter((id) => !appModel.isMastered(id))
    .map((id) => appModel.node(id)?.title ?? id)
  return (
    <div className="locked-banner">
      🔰 先掌握前置节点：{missing.join('、')}，再来挑战这一关。
    </div>
  )
}

/** 讲解块：text / examples / tip */
function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'examples':
      return (
        <div className="examples-block">
          <div className="examples-title">例句</div>
          <ul>
            {(block.items ?? []).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )
    case 'tip':
      return <div className="tip-block">💡 {block.text}</div>
    default:
      return <p className="text-block">{block.text}</p>
  }
}
