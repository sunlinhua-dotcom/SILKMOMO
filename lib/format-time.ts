/**
 * 相对时间文案（中文）。语义照搬 components/TaskList.tsx 的 formatDate：
 *   <1 分钟（含未来时间）→ 刚刚；<60 分钟 → N分钟前；<24 小时 → N小时前；<7 天 → N天前；
 *   更早 → 「M月D日」。无法解析的输入返回空串。
 */
export function formatRelativeTime(input: Date | number | string, now: number = Date.now()): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
