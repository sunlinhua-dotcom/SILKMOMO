'use client';

import { useEffect, useState } from 'react';
import { getRandomWaitingMessage } from '@/lib/api';

interface RotatingTipsProps {
  /** 服务端心跳带来的阶段文案：到达时先显示它，下一次轮播再换回随机提示 */
  override?: string;
}

/**
 * 等待提示轮播（每 4 秒换一条）。
 * 状态放在本组件内部、且只在 generating 时挂载：
 * 以前这个定时器挂在整个任务页上，页面空闲时也每 4 秒重渲一次大组件。
 */
export function RotatingTips({ override }: RotatingTipsProps) {
  const [tip, setTip] = useState(() => getRandomWaitingMessage());
  const [held, setHeld] = useState<string | null>(null);
  const [prevOverride, setPrevOverride] = useState(override);

  // 渲染期同步 prop 变化（React 推荐写法），避免在 effect 里同步 setState
  if (override !== prevOverride) {
    setPrevOverride(override);
    if (override) setHeld(override);
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTip(getRandomWaitingMessage());
      setHeld(null);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return <>{held ?? tip}</>;
}
