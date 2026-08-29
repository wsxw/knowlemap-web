import { useSyncExternalStore } from 'react'
import { AppModel, AppState } from './state/AppModel'

/** 单例应用模型（与 Mac 版 @EnvironmentObject 单例语义一致） */
export const appModel = new AppModel()

export function useAppState(): AppState {
  return useSyncExternalStore(appModel.subscribe, appModel.getSnapshot)
}
