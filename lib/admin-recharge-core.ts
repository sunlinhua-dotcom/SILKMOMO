/**
 * 管理员充值的幂等核心（纯逻辑，不 import 任何运行时依赖，方便 node:test 直接加载）。
 *
 * 为什么存在：充值接口原先只有按钮防双击——网络超时后重试、浏览器重放、代理重发都会重复入账。
 * 现在前端每次确认充值生成一个 requestId，服务端把 `admin-recharge:<requestId>` 写进
 * `Transaction.idempotencyKey`（@unique）：
 *   1. 事务内先查键，命中就直接返回第一次的结果（duplicate: true），不加钱；
 *   2. 并发场景两个请求都没查到时，加余额 + 写流水在同一个事务里，唯一索引决定胜者，
 *      败者事务整体回滚（含余额增量），捕获 P2002 后再读胜者流水返回。
 * 没带 requestId 的老请求保持原行为（不幂等），由调用方打告警日志。
 */

export const ADMIN_RECHARGE_KEY_PREFIX = 'admin-recharge:';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** requestId 必须是 UUID 形态（前端 crypto.randomUUID()）。返回规范化（小写）后的值，非法返回 null。 */
export function parseRechargeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function adminRechargeKey(requestId: string): string {
  return `${ADMIN_RECHARGE_KEY_PREFIX}${requestId}`;
}

export const MIN_ADMIN_RECHARGE_FEN = 15000;
export const ADMIN_RECHARGE_STEP_FEN = 7500;

export type AdminRechargeBodyResult =
  | { ok: true; input: AdminRechargeInput; legacy: boolean }
  | { ok: false; status: 400; error: string };

/**
 * 校验管理员充值请求体。requestId 缺省 = 老前端/老脚本（legacy: true，调用方应打告警日志，行为同旧版不幂等）；
 * 带了但格式不是 UUID 一律 400，不降级成不幂等，免得拼错的 requestId 悄悄失去保护。
 */
export function parseAdminRechargeBody(body: unknown): AdminRechargeBodyResult {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { userId, amountFen, description } = raw;

  if (
    typeof userId !== 'string' || !userId
    || typeof amountFen !== 'number' || !Number.isInteger(amountFen)
    || amountFen < MIN_ADMIN_RECHARGE_FEN || amountFen % ADMIN_RECHARGE_STEP_FEN !== 0
  ) {
    return { ok: false, status: 400, error: '最低充值 ¥150，且必须是 ¥75 的倍数' };
  }

  let requestId: string | undefined;
  const legacy = raw.requestId === undefined || raw.requestId === null || raw.requestId === '';
  if (!legacy) {
    const parsed = parseRechargeRequestId(raw.requestId);
    if (!parsed) return { ok: false, status: 400, error: 'requestId 格式非法（应为 UUID）' };
    requestId = parsed;
  }

  const note = typeof description === 'string' ? description.trim() : '';
  return {
    ok: true,
    legacy,
    input: {
      userId,
      amountFen,
      description: note || `管理员充值 ¥${(amountFen / 100).toFixed(2)}`,
      requestId,
    },
  };
}

export interface AdminRechargeInput {
  userId: string;
  amountFen: number;
  description: string;
  /** 已经过 parseRechargeRequestId 校验的 requestId；缺省表示老请求（不幂等）。 */
  requestId?: string;
}

export interface AdminRechargeResult {
  success: boolean;
  balanceAfter: number;
  /** 命中幂等键：本次没有加钱，balanceAfter 是第一次入账后的余额快照。 */
  duplicate?: boolean;
  error?: string;
  /** 同一个 requestId 被用于不同用户/金额等冲突情形（调用方应回 409）。 */
  conflict?: boolean;
}

interface ExistingRecharge {
  id: string;
  userId: string;
  type: string;
  amountFen: number;
  balanceAfter: number;
}

export interface AdminRechargeTransaction {
  transaction: {
    findUnique(args: {
      where: { idempotencyKey: string };
      select: { id: true; userId: true; type: true; amountFen: true; balanceAfter: true };
    }): Promise<ExistingRecharge | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    update(args: {
      where: { id: string };
      data: { balanceFen: { increment: number } };
    }): Promise<{ balanceFen: number }>;
  };
}

export interface AdminRechargePrisma {
  $transaction<T>(fn: (tx: AdminRechargeTransaction) => Promise<T>): Promise<T>;
  transaction: AdminRechargeTransaction['transaction'];
}

const EXISTING_SELECT = { id: true, userId: true, type: true, amountFen: true, balanceAfter: true } as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}

/** 同一个 requestId 命中的旧流水是否确实是「同一笔」充值。 */
function describeExisting(existing: ExistingRecharge, input: AdminRechargeInput): AdminRechargeResult {
  if (existing.type !== 'recharge' || existing.userId !== input.userId || existing.amountFen !== input.amountFen) {
    return {
      success: false,
      balanceAfter: 0,
      conflict: true,
      error: '该 requestId 已用于另一笔不同的充值，请刷新页面后重新发起',
    };
  }
  return { success: true, balanceAfter: existing.balanceAfter, duplicate: true };
}

export async function rechargeWithIdempotency(
  prisma: AdminRechargePrisma,
  input: AdminRechargeInput,
): Promise<AdminRechargeResult> {
  const key = input.requestId ? adminRechargeKey(input.requestId) : undefined;
  try {
    return await prisma.$transaction(async (tx): Promise<AdminRechargeResult> => {
      if (key) {
        const existing = await tx.transaction.findUnique({ where: { idempotencyKey: key }, select: EXISTING_SELECT });
        if (existing) return describeExisting(existing, input);
      }

      const updated = await tx.user.update({
        where: { id: input.userId },
        data: { balanceFen: { increment: input.amountFen } },
      });
      await tx.transaction.create({
        data: {
          userId: input.userId,
          type: 'recharge',
          amountFen: input.amountFen,
          balanceAfter: updated.balanceFen,
          description: input.description,
          ...(key ? { idempotencyKey: key } : {}),
        },
      });
      return { success: true, balanceAfter: updated.balanceFen };
    });
  } catch (error) {
    // 两个并发请求都在事务内查不到键时由唯一索引决出胜者；败者的整个事务（含余额增量）已回滚，
    // 这里读取胜者流水原样返回，绝不再加钱。
    if (key && isUniqueViolation(error)) {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: key }, select: EXISTING_SELECT });
      if (existing) return describeExisting(existing, input);
    }
    const msg = error instanceof Error ? error.message : '充值失败';
    return { success: false, balanceAfter: 0, error: msg };
  }
}
