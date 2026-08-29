import { RewardInfo } from '../domain/models'
import { appModel } from '../useAppModel'
import { NumberTicker } from '@/components/motion/number-ticker'
import Confetti from '@/components/Confetti'

/** 通关奖励弹层：彩带 + XP 数字滚动 / 新徽章 / 解锁节点（首次通关触发） */
export default function RewardOverlay({ reward }: { reward: RewardInfo }) {
  return (
    <div className="reward-backdrop" onClick={() => appModel.dismissReward()}>
      <Confetti />
      <div className="reward-card" onClick={(e) => e.stopPropagation()}>
        <div className="reward-emoji">🎉</div>
        <h2>节点点亮！</h2>

        <div className="reward-xp">
          ⚡ +<NumberTicker value={reward.xpGained} duration={0.9} /> XP
        </div>

        {reward.newBadges.length > 0 && (
          <div className="reward-badges">
            <h4>获得新徽章</h4>
            {reward.newBadges.map((badge) => (
              <span key={badge.id} className="reward-badge-chip">
                {badge.icon} <strong>{badge.name}</strong>
              </span>
            ))}
          </div>
        )}

        {reward.unlockedNodeTitles.length > 0 && (
          <div className="reward-unlock">
            <h4>解锁新节点</h4>
            <p>{reward.unlockedNodeTitles.join(' · ')}</p>
          </div>
        )}

        <button className="primary-btn" onClick={() => appModel.dismissReward()}>
          继续学习
        </button>
      </div>
    </div>
  )
}
