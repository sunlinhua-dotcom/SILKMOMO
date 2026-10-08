export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startModelFaceJobSupervisor } = await import('@/lib/model-face-jobs');
  startModelFaceJobSupervisor();
  // 出图计费孤儿清扫（每 5 分钟）+ 顺带清理过期 pending 交接图
  const { startBillingReconciler } = await import('@/lib/billing-reconcile');
  startBillingReconciler();
  // 数据保留清理：启动 10 分钟后首跑、之后每 24 小时一次（RETENTION_DISABLED=1 关闭，RETENTION_DRY_RUN=1 只统计）
  const { startRetentionScheduler } = await import('@/lib/retention');
  startRetentionScheduler();
}
