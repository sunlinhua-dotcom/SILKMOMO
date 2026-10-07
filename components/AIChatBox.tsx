'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { refreshBalance } from '@/hooks/useBalance';
import { Sparkles, Send, Loader2, X, ChevronDown, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';

interface AIActions {
  bodyType?: 'slim' | 'standard' | 'curvy' | null;
  skinTone?: 'light' | 'medium' | 'deep' | null;
  module?: 'product' | 'scene' | null;
  prompt?: string | null;
  triggerGenerate?: boolean;
}

interface Message {
  role: 'user' | 'ai';
  text: string;
  actions?: AIActions;
  /** 服务端/网络错误：用警示样式展示，不当作 AI 的正常回复 */
  isError?: boolean;
}

interface AIChatBoxProps {
  context?: string;
  onActions?: (actions: AIActions) => void;
  /**
   * AI 判定用户要「立即生成」时通知调用方（约 500ms 后，等 onActions 引发的 state 更新落定）。
   * 本组件只负责通知，**不会自己创建任务或花钱；调用方负责在回调里弹确认（说明费用）后再生成**。
   * 组件卸载时尚未触发的通知会被取消。
   */
  onTriggerGenerate?: () => void;
  hideBodySkinQuickTags?: boolean;
  /** 布局模式：sidebar = 桌面左侧边栏，bottom = 移动端底栏 */
  mode?: 'sidebar' | 'bottom';
  /** 空状态提示文案（不传则显示默认） */
  emptyStateHint?: string;
  /** 输入框 placeholder */
  placeholder?: string;
}

// ─── 公共：发送逻辑 Hook ─────────────────────────────────────────────────────

const FALLBACK_ERROR = '网络异常，请稍后再试。';

/** 把 /api/ai/chat 的失败响应转成给用户看的中文文案（服务端 400/429 已带中文 error） */
function describeChatError(status: number, data: { error?: unknown } | null, retryAfter: string | null): string {
  const serverMsg = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : '';
  if (serverMsg) return serverMsg;
  if (status === 401) return '登录已过期，请刷新页面重新登录。';
  if (status === 429) {
    const sec = Number(retryAfter);
    return Number.isFinite(sec) && sec > 0 ? `请求太频繁了，请 ${Math.ceil(sec)} 秒后再试` : '请求太频繁了，请稍后再试';
  }
  if (status >= 500) return '服务暂时不可用，请稍后再试。';
  return FALLBACK_ERROR;
}

function useAIChat(context?: string, onActions?: (a: AIActions) => void, onTriggerGenerate?: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const triggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 始终调用"最新一次渲染"的回调。
  // 直接在 setTimeout 里调 props 会捕获发送时刻的旧闭包：
  // onActions setState 改了体型/肤色/模块后，500ms 后触发的 onTriggerGenerate
  // 仍读到改参数之前的旧 state → 用旧参数创建任务并扣费。
  const onActionsRef = useRef(onActions);
  const onTriggerGenerateRef = useRef(onTriggerGenerate);
  useEffect(() => {
    onActionsRef.current = onActions;
    onTriggerGenerateRef.current = onTriggerGenerate;
  });

  // 卸载：取消进行中的请求与尚未触发的「生成」通知
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (triggerTimerRef.current) clearTimeout(triggerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    // loadingRef 同步拦截：state 更新前的连点/连按回车也不会重复发送
    if (!msg || loadingRef.current) return;
    loadingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'ai', text: describeChatError(res.status, data, res.headers.get('Retry-After')), isError: true }]);
        // 没发出去的话还回输入框，免得用户重打（期间用户已输入新内容则不覆盖）
        setInput(cur => (cur ? cur : msg));
        return;
      }
      const reply = typeof data?.reply === 'string' && data.reply ? data.reply : '收到！';
      const actions: AIActions = data?.actions || {};
      setMessages(prev => [...prev, { role: 'ai', text: reply, actions }]);
      void refreshBalance(); // 每次对话都计费，同步顶部余额
      if (onActionsRef.current && Object.keys(actions).length > 0) onActionsRef.current(actions);
      if (actions.triggerGenerate && onTriggerGenerateRef.current) {
        // 等 onActions 引发的 re-render 完成后再触发，此时 ref 里已是携带新 state 的回调
        if (triggerTimerRef.current) clearTimeout(triggerTimerRef.current);
        triggerTimerRef.current = setTimeout(() => {
          triggerTimerRef.current = null;
          onTriggerGenerateRef.current?.();
        }, 500);
      }
    } catch {
      if (controller.signal.aborted) return;
      setMessages(prev => [...prev, { role: 'ai', text: FALLBACK_ERROR, isError: true }]);
      setInput(cur => (cur ? cur : msg));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      loadingRef.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [input, context]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // 输入法选词/确认时的回车不是「发送」（keyCode 229 兼容 Safari 在 compositionend 之后才触发 keydown）
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    handleSend();
  };

  return { messages, input, setInput, loading, scrollRef, inputRef, handleSend, handleKeyDown };
}

/** 消息气泡（桌面/移动共用）。错误消息用 danger 色 + role="alert" 之外的 live region 统一由外层播报 */
function ChatBubble({ msg, maxWidth, showGenerating }: { msg: Message; maxWidth: string; showGenerating?: boolean }) {
  const cls = msg.role === 'user'
    ? 'bg-brand-strong text-white rounded-br-sm'
    : msg.isError
      ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] rounded-bl-sm border border-[var(--color-danger)]/30'
      : 'bg-[var(--color-background)] text-[var(--color-text)] rounded-bl-sm border border-[var(--color-border-light)]';
  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`${maxWidth} min-w-0 px-3 py-2 rounded-xl text-xs leading-relaxed break-words ${cls}`}>
        <p className="whitespace-pre-wrap">{msg.text}</p>
        {showGenerating && msg.actions?.triggerGenerate && (
          <p className="mt-1 text-[11px] opacity-70">⚡ 即将为你准备生成…</p>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="px-3 py-2 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] rounded-bl-sm">
        <div className="flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 text-[var(--color-brand-strong)] animate-spin" aria-hidden="true" />
          <span className="text-[11px] text-[var(--color-text-muted)]">AI 思考中…</span>
        </div>
      </div>
    </div>
  );
}

// ─── 桌面端：左侧可折叠侧边栏 ────────────────────────────────────────────────

export function AIChatSidebar({ context, onActions, onTriggerGenerate, hideBodySkinQuickTags, emptyStateHint, placeholder }: Omit<AIChatBoxProps, 'mode'>) {
  const [collapsed, setCollapsed] = useState(false);
  const { messages, input, setInput, loading, scrollRef, inputRef, handleSend, handleKeyDown } = useAIChat(context, onActions, onTriggerGenerate);

  const QUICK_TAGS = hideBodySkinQuickTags
    ? ['产品图', '场景图', '极简背景']
    : ['产品图', '场景图', '纤细体型', '白皙肤色', '极简背景'];

  return (
    <aside
      className={`
        hidden lg:flex flex-col fixed left-0 top-0 h-screen z-40
        transition-all duration-500 ease-in-out
        ${collapsed ? 'w-14' : 'w-72'}
        bg-[var(--color-surface)] border-r border-[var(--color-border-light)]
        shadow-lg
      `}
    >
      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="absolute -right-3 top-24 w-6 h-6 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-light)] shadow flex items-center justify-center z-50 hover:bg-[var(--color-background)] transition-colors"
        aria-label={collapsed ? "展开 AI 对话侧边栏" : "折叠 AI 对话侧边栏"}
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" aria-hidden="true" />
          : <ChevronLeft className="w-3 h-3 text-[var(--color-text-muted)]" aria-hidden="true" />
        }
      </button>

      {/* Logo 区域 */}
      <div className={`flex items-center gap-2 px-3.5 py-5 border-b border-[var(--color-border-light)] ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[var(--color-ink)] to-[var(--color-brand-strong)] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--color-primary)] tracking-wide">AI Stylist</p>
            <p className="text-[11px] text-[var(--color-text-muted)] tracking-widest uppercase">¥0.35/次</p>
          </div>
        )}
      </div>

      {/* 折叠状态：只显示图标 */}
      {collapsed && (
        <div className="flex flex-col items-center gap-4 pt-6 px-2">
          <MessageSquare className="w-4 h-4 text-[var(--color-text-muted)]" strokeWidth={1.5} />
        </div>
      )}

      {/* 展开状态：完整对话界面 */}
      {!collapsed && (
        <>
          {/* 快捷标签 */}
          <div className="px-3 pt-3 pb-2 flex flex-wrap gap-1.5 border-b border-[var(--color-border-light)]">
            {QUICK_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => { setInput(prev => prev ? `${prev}，${tag}` : tag); inputRef.current?.focus(); }}
                className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--color-background)] text-[var(--color-text-secondary)] hover:text-[var(--color-ink)] hover:bg-[var(--color-brand-soft)] transition-all duration-200 border border-transparent hover:border-[var(--color-accent)]/30"
              >
                {tag}
              </button>
            ))}
          </div>

          {/* 对话历史 */}
          <div
            ref={scrollRef as React.RefObject<HTMLDivElement>}
            role="log"
            aria-live="polite"
            aria-label="AI 对话记录"
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8 px-2">
                <div className="w-10 h-10 rounded-2xl bg-[var(--color-background)] flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-[var(--color-brand-strong)]" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed whitespace-pre-line">
                  {emptyStateHint ?? '描述你的创意构想\nAI 自动设定参数\n\n💡 想调整已生成的图？\n点击图片 → ✨ 描述要调整什么'}
                </p>
              </div>
            ) : (
              messages.map((msg, i) => <ChatBubble key={i} msg={msg} maxWidth="max-w-[90%]" showGenerating />)
            )}
            {loading && <ThinkingBubble />}
          </div>

          {/* 输入框 */}
          <div className="px-3 py-3 border-t border-[var(--color-border-light)]">
            <div className="flex items-end gap-2 bg-[var(--color-background)] rounded-xl border border-[var(--color-border-light)] px-3 py-2 focus-within:border-[var(--color-accent)]/40 transition-colors">
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                id="chatInput"
                name="chatInput"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder ?? '描述你的需求…'}
                rows={2}
                aria-label="输入创意构想"
                className="flex-1 min-w-0 text-xs bg-transparent border-0 focus:ring-0 focus:outline-none resize-none placeholder:text-[var(--color-text-muted)] text-[var(--color-text)]"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="w-7 h-7 rounded-lg bg-[var(--color-brand-strong)] text-white flex items-center justify-center hover:bg-[var(--color-ink)] disabled:opacity-40 transition-all duration-300 flex-shrink-0 mb-0.5"
                aria-label="发送消息"
              >
                {loading
                  ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  : <Send className="w-3 h-3" aria-hidden="true" />
                }
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

// ─── 移动端：固定底栏 ────────────────────────────────────────────────────────

export function AIChatBottomBar({ context, onActions, onTriggerGenerate, hideBodySkinQuickTags }: Omit<AIChatBoxProps, 'mode'>) {
  const [expanded, setExpanded] = useState(false);
  const { messages, input, setInput, loading, scrollRef, inputRef, handleSend, handleKeyDown } = useAIChat(context, onActions, onTriggerGenerate);

  const QUICK_TAGS = hideBodySkinQuickTags
    ? ['产品图', '场景图']
    : ['产品图', '场景图', '纤细', '白皙'];
  const latestAIMsg = messages.filter(m => m.role === 'ai').at(-1);

  return (
    <div className={`
      lg:hidden fixed left-0 right-0 z-50 max-w-full
      bg-[var(--color-surface)]/95 backdrop-blur-xl
      border-t border-[var(--color-border-light)]
      transition-all duration-400 ease-in-out
    `}
    // 让出页面固定底栏（--mobile-cta-h，由页面设置）与安全区，避免叠在首页快速生成条上
    style={{ bottom: 'calc(var(--mobile-cta-h, 0px) + env(safe-area-inset-bottom))' }}>
      {/* 展开时：对话历史区 */}
      {expanded && (
        <div className="border-b border-[var(--color-border-light)]">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[11px] font-medium text-[var(--color-text-muted)] tracking-wide uppercase">AI 对话</span>
            <button onClick={() => setExpanded(false)} className="p-1 rounded-lg hover:bg-[var(--color-background)] transition-colors" aria-label="关闭 AI 对话">
              <X className="w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
            </button>
          </div>
          <div
            ref={scrollRef as React.RefObject<HTMLDivElement>}
            role="log"
            aria-live="polite"
            aria-label="AI 对话记录"
            className="max-h-40 overflow-y-auto px-4 pb-3 space-y-2"
          >
            {messages.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] text-center py-3">告诉 AI 你的创意构想...</p>
            ) : (
              messages.map((msg, i) => <ChatBubble key={i} msg={msg} maxWidth="max-w-[85%]" />)
            )}
            {loading && <ThinkingBubble />}
          </div>
        </div>
      )}

      {/* 主输入行 */}
      <div className="px-3 py-2.5 flex min-w-0 items-center gap-2">
        {/* AI 图标 + 折叠切换 */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-ink)] to-[var(--color-brand-strong)] flex items-center justify-center flex-shrink-0"
          aria-label={expanded ? "收起 AI 对话历史" : "展开 AI 对话历史"}
        >
          {expanded
            ? <ChevronDown className="w-4 h-4 text-[var(--color-accent)]" aria-hidden="true" />
            : <Sparkles className="w-4 h-4 text-[var(--color-accent)]" aria-hidden="true" />
          }
        </button>

        {/* 输入框 */}
        <div className="flex-1 min-w-0 flex items-center bg-[var(--color-background)] rounded-xl border border-[var(--color-border-light)] px-3 py-2 focus-within:border-[var(--color-accent)]/40 transition-colors">
          {!expanded && latestAIMsg && !input ? (
            <button
              onClick={() => setExpanded(true)}
              className="flex-1 min-w-0 text-xs text-left text-[var(--color-text-muted)] truncate"
            >
              {latestAIMsg.text.slice(0, 40)}{latestAIMsg.text.length > 40 ? '…' : ''}
            </button>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              id="chatInputMobile"
              name="chatInputMobile"
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setExpanded(true)}
              placeholder="告诉 AI 你的设想…"
              aria-label="告诉 AI 你的设想"
              className="flex-1 min-w-0 w-full text-base bg-transparent border-0 focus:ring-0 focus:outline-none placeholder:text-[var(--color-text-muted)] text-[var(--color-text)]"
            />
          )}
        </div>

        {/* 发送 */}
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="w-9 h-9 rounded-xl bg-[var(--color-brand-strong)] text-white flex items-center justify-center hover:bg-[var(--color-ink)] disabled:opacity-40 transition-all duration-300 flex-shrink-0"
          aria-label="发送消息"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            : <Send className="w-4 h-4" aria-hidden="true" />
          }
        </button>
      </div>

      {/* 快捷标签行 */}
      {!expanded && (
        <div className="px-4 pb-2 flex min-w-0 items-center gap-2">
          <span className="text-[11px] text-[var(--color-text-muted)] tracking-wider uppercase flex-shrink-0">✨ AI</span>
          <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-none">
            {QUICK_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => { setInput(prev => prev ? `${prev}，${tag}` : tag); setExpanded(true); inputRef.current?.focus(); }}
                className="text-[11px] px-2.5 py-0.5 rounded-full border border-transparent bg-[var(--color-background)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-ink)] transition-all duration-200 whitespace-nowrap"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 旧版兼容导出（顶部搜索栏形态，仅移动端底栏向上兼容）───────────────────

/** @deprecated 使用 AIChatSidebar（桌面）+ AIChatBottomBar（移动）代替 */
export function AIChatBox({ context, onActions, onTriggerGenerate, hideBodySkinQuickTags }: AIChatBoxProps) {
  return (
    <>
      <AIChatSidebar context={context} onActions={onActions} onTriggerGenerate={onTriggerGenerate} hideBodySkinQuickTags={hideBodySkinQuickTags} />
      <AIChatBottomBar context={context} onActions={onActions} onTriggerGenerate={onTriggerGenerate} hideBodySkinQuickTags={hideBodySkinQuickTags} />
    </>
  );
}
