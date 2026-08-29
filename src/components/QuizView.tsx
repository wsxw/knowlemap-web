import { useEffect, useState } from 'react'
import { KnowledgeNode } from '../domain/models'
import * as engine from '../domain/learningEngine'
import { appModel, useAppState } from '../useAppModel'

interface Props {
  node: KnowledgeNode
  onExit: () => void
}

/** 闯关测试视图：逐题作答、即时反馈、结算（≥80% 通关） */
export default function QuizView({ node, onExit }: Props) {
  useAppState()
  const questions = node.quiz.questions

  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [inputText, setInputText] = useState('')
  const [evaluated, setEvaluated] = useState(false)
  const [currentCorrect, setCurrentCorrect] = useState(false)
  const [finished, setFinished] = useState(false)

  const current = questions[index]

  // 切换节点时重置（对齐 Mac 版 .id(node.id) 重建语义）
  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  /** ⌘↩ / Ctrl+↩ 提交填空；评测后回车直接进入下一题（Web 版新增快捷键） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || evaluated) {
        if ((e.key === 'Enter' || e.key === 'ArrowRight') && evaluated && !finished) advance()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitFillIn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, evaluated, index, inputText])

  const evaluateChoice = (choice: number) => {
    if (evaluated) return
    setSelectedOption(choice)
    setCurrentCorrect(choice === current.answerIndex)
    setEvaluated(true)
    setResults((r) => [...r, choice === current.answerIndex])
  }

  const submitFillIn = () => {
    if (evaluated || current.type === 'choice') return
    const answer = current.answerText
    if (!answer || inputText.trim() === '') return
    const ok = engine.isFillInAnswerCorrect(inputText, answer)
    setCurrentCorrect(ok)
    setEvaluated(true)
    setResults((r) => [...r, ok])
  }

  const revealAnswer = (): string => {
    if (current.type === 'choice') {
      const opts = current.options
      const idx = current.answerIndex
      if (opts && idx !== undefined && idx >= 0 && idx < opts.length) return opts[idx]
    }
    return current.answerText ?? '—'
  }

  const advance = () => {
    if (index === questions.length - 1) {
      const correct = results.filter(Boolean).length
      appModel.finishQuiz(node, correct)
      setFinished(true)
    } else {
      setIndex((i) => i + 1)
      setSelectedOption(null)
      setInputText('')
      setEvaluated(false)
      setCurrentCorrect(false)
    }
  }

  function reset() {
    setIndex(0)
    setResults([])
    setSelectedOption(null)
    setInputText('')
    setEvaluated(false)
    setCurrentCorrect(false)
    setFinished(false)
  }

  if (questions.length === 0) {
    return (
      <div className="quiz-wrap">
        <p>这个节点还没有题目。</p>
        <button className="secondary-btn" onClick={onExit}>返回节点</button>
      </div>
    )
  }

  if (finished) {
    return <ResultView node={node} results={results} retry={reset} exit={onExit} />
  }

  const correctCount = results.filter(Boolean).length

  return (
    <div className="detail-scroll">
      <div className="detail-inner quiz-wrap">
        <header className="quiz-header">
          <strong>⚔️ {node.title} · 第 {index + 1} / {questions.length} 题</strong>
          <span className="caption">已答对 {correctCount} 题</span>
        </header>
        <ProgressBarQuiz value={index / questions.length} />

        <p className="quiz-prompt">{current.prompt}</p>

        {current.type === 'choice' ? (
          <div className="option-list">
            {(current.options ?? []).map((option, i) => {
              let cls = 'option-row'
              if (!evaluated) {
                if (selectedOption === i) cls += ' picked'
              } else if (i === current.answerIndex) {
                cls += ' correct'
              } else if (i === selectedOption) {
                cls += ' wrong'
              }
              return (
                <button key={i} className={cls} disabled={evaluated} onClick={() => evaluateChoice(i)}>
                  <span>{option}</span>
                  <span className="option-mark">
                    {evaluated
                      ? i === current.answerIndex ? '✔' : i === selectedOption ? '✘' : ''
                      : selectedOption === i ? '●' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="fillin-section">
            {!evaluated ? (
              <>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.metaKey && !e.ctrlKey && submitFillIn()}
                  placeholder="在这里输入你的答案"
                  autoFocus
                />
                <button className="primary-btn" disabled={!inputText.trim()} onClick={submitFillIn}>
                  提交答案（⌘↩）
                </button>
              </>
            ) : null}
          </div>
        )}

        {evaluated && (
          <>
            <div className={`feedback ${currentCorrect ? 'ok' : 'bad'}`}>
              <strong>
                {currentCorrect ? '回答正确！' : `答错了，正确答案是：${revealAnswer()}`}
              </strong>
              <p className="caption">{current.explanation}</p>
            </div>
            <button className="primary-btn" onClick={advance}>
              {index === questions.length - 1 ? '查看结果' : '下一题'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// MARK: 结算页

function ResultView({
  node,
  results,
  retry,
  exit,
}: {
  node: KnowledgeNode
  results: boolean[]
  retry: () => void
  exit: () => void
}) {
  useAppState()
  const total = node.quiz.questions.length
  const correct = results.filter(Boolean).length
  const passed = appModel.getSnapshot().profile.nodeProgress[node.id]?.passed === true &&
    engine.isPassed(correct, total, node.quiz.passThreshold)

  const recs =
    passed && appModel.pack
      ? engine.nextRecommendations(node, appModel.pack, appModel.mastered)
      : []

  return (
    <div className="result-view">
      <div className="result-emoji">{passed ? '🎉' : '😅'}</div>
      <h2>{passed ? '通关成功！' : '差一点点，再试一次'}</h2>
      <div className={`result-score ${passed ? 'green' : 'orange'}`}>
        成绩 {correct} / {total}（通关线 {Math.round(node.quiz.passThreshold * 100)}%）
      </div>

      {passed && recs.length > 0 && (
        <div className="recs">
          <h4>下一步推荐</h4>
          {recs.map((rec) => (
            <button
              key={rec.id}
              className="secondary-btn"
              onClick={() => {
                appModel.selectNode(rec.id)
                exit()
              }}
            >
              ➡ 去学「{rec.title}」
            </button>
          ))}
        </div>
      )}

      {!passed && (
        <p className="caption center">
          建议：回到讲解再看一遍，重点看错题对应的知识点，然后重新挑战。
        </p>
      )}

      <div className="result-actions">
        <button className="secondary-btn" onClick={exit}>返回节点</button>
        <button className="primary-btn" onClick={retry}>{passed ? '再刷一次' : '再测一次'}</button>
      </div>
    </div>
  )
}

function ProgressBarQuiz({ value }: { value: number }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${value * 100}%` }} />
    </div>
  )
}
