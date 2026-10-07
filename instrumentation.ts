export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startModelFaceJobSupervisor } = await import('@/lib/model-face-jobs');
  startModelFaceJobSupervisor();
  // 出图计费孤儿清扫（每 5 分钟）+ 顺带清理过期 pending 交接图
  const { startBillingReconciler } = await import('@/lib/billing-reconcile');
  startBillingReconciler();
}
