'use client';

import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * 单选组的 roving tabindex + 方向键切换（WAI-ARIA radiogroup 模式）。
 *
 * - 组容器：展开 `groupProps`（role=radiogroup + ref），并自行加 aria-labelledby / aria-label。
 * - 每个选项：展开 `itemProps(id)`（role=radio、aria-checked、tabIndex、onKeyDown），
 *   点击由调用方自己绑 onClick。
 * - ←/↑ 上一个，→/↓ 下一个，Home/End 首尾；移动焦点的同时选中（与原生 radio 一致）。
 * - 当前值不在选项里（比如「未选」）时，第一个选项承接 Tab 焦点。
 */
export function useRadioGroup<T extends string>(
  ids: readonly T[],
  value: T | '' | undefined | null,
  onChange: (id: T) => void,
) {
  const groupRef = useRef<HTMLDivElement>(null);
  const hasSelected = value != null && (ids as readonly string[]).includes(value);

  const focusAt = useCallback((index: number) => {
    const nodes = groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    nodes?.[index]?.focus();
  }, []);

  const itemProps = (id: T) => {
    const index = ids.indexOf(id);
    const checked = hasSelected ? id === value : false;
    return {
      role: 'radio' as const,
      'aria-checked': checked,
      tabIndex: checked || (!hasSelected && index === 0) ? 0 : -1,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        let next = -1;
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            next = (index + 1) % ids.length;
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            next = (index - 1 + ids.length) % ids.length;
            break;
          case 'Home':
            next = 0;
            break;
          case 'End':
            next = ids.length - 1;
            break;
          default:
            return;
        }
        e.preventDefault();
        if (next === index) return;
        onChange(ids[next]);
        focusAt(next);
      },
    };
  };

  return { groupProps: { role: 'radiogroup' as const, ref: groupRef }, itemProps };
}
