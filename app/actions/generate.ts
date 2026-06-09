'use server';

// ⚠️ 此 Server Action 已废弃 ⚠️
//
// 旧实现存在多处 "扣费成功但不退款" 的资金安全 bug。
// 所有生图调用都已迁移到 /api/generate/stream（SSE 流式接口）。
//
// 此文件保留以便编译器抓到任何遗漏的调用：直接返回失败而不是默默走旧路径
// 吞用户的钱。

export async function generateImageAction(): Promise<{
  success: false;
  error: string;
}> {
  console.error('[generateImageAction] 被调用，但此接口已废弃。请改用 POST /api/generate/stream。');
  return {
    success: false,
    error: '此生成接口已下线，请刷新页面后重试（系统将走新接口）。',
  };
}
