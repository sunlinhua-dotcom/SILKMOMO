'use client';

import { Modal } from '@/components/ui/Modal';
import { ContactAdmin } from '@/components/ContactAdmin';
import { formatYuan } from '@/lib/task-page-helpers';

/** 余额不足：引导联系管理员充值（与首页口径一致）。needFen = null 时关闭。 */
export function RechargeModal({
  needFen,
  balanceFen,
  onClose,
}: {
  needFen: number | null;
  balanceFen: number | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={needFen !== null}
      onClose={onClose}
      title="余额不足"
      size="sm"
    >
      <div className="space-y-4 pt-1">
        <p>
          这次操作需要 <span className="num font-semibold text-[var(--color-ink)]">{formatYuan(needFen ?? 0)}</span>
          {balanceFen !== null && (
            <>
              ，当前余额 <span className="num font-semibold text-[var(--color-ink)]">{formatYuan(balanceFen)}</span>
              ，还差 <span className="num font-semibold text-[var(--color-danger)]">{formatYuan(Math.max(0, (needFen ?? 0) - balanceFen))}</span>
            </>
          )}
          。
        </p>
        <ContactAdmin variant="card" note="目前为人工核账充值，复制管理员微信号添加后即可快速到账。" />
      </div>
    </Modal>
  );
}
