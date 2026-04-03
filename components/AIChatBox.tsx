'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
}

interface AIChatBoxProps {
  context?: string;
  onActions?: (actions: AIActions) => void;
  onTriggerGenerate?: () => void;
  /** 布局模式：sidebar = 桌面左侧边栏，bottom = 移动端底栏 */
  mode?: 'sidebar' | 'bottom';
}

// ─── 公共：发送逻辑 Hook ─────────────────────────────────────────────────────

function useAIChat(context?: string, onActions?: (a: AIActions) => void, onTriggerGenerate?: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context }),
      });
      const data = await res.json();
      const reply = data.reply || '收到！';
      const actions: AIActions = data.actions || {};
      setMessages(prev => [...prev, { role: 'ai', text: reply, actions }]);
      if (onActions && Object.keys(actions).length > 0) onActions(actions);
      if (actions.triggerGenerate && onTriggerGenerate) {
        setTimeout(() => onTriggerGenerate(), 500);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: '网络异常，请稍后再试。' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, context, onActions, onTriggerGenerate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return { messages, input, setInput, loading, scrollRef, inputRef, handleSend, handleKeyDown };
}

// ─── 桌面端：左侧可折叠侧边栏 ────────────────────────────────────────────────

export function AIChatSidebar({ context, onActions, onTriggerGenerate }: Omit<AIChatBoxProps, 'mode'>) {
  const [collapsed, setCollapsed] = useState(false);
  const { messages, input, setInput, loading, scrollRef, inputRef, handleSend, handleKeyDown } = useAIChat(context, onActions, onTriggerGenerate);

  const QUICK_TAGS = ['产品图', '场景图', '纤细体型', '白皙肤色', '极简背景'];

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
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
          : <ChevronLeft className="w-3 h-3 text-[var(--color-text-muted)]" />
        }
      </button>

      {/* Logo 区域 */}
      <div className={`flex items-center gap-2 px-3.5 py-5 border-b border-[var(--color-border-light)] ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#5C4A3A] to-[#8B6F47] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--color-primary)] tracking-wide">AI Stylist</p>
            <p className="text-[9px] text-[var(--color-text-muted)] tracking-widest uppercase">¥0.35/次</p>
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
                className="text-[10px] px-2.5 py-1 rounded-full bg-[var(--color-background)] text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[rgba(212,175,55,0.08)] transition-all duration-200 border border-transparent hover:border-[var(--color-accent)]/30"
              >
                {tag}
              </button>
            ))}
          </div>

          {/* 对话历史 */}
          <div
            ref={scrollRef as React.RefObject<HTMLDivElement>}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
                <div className="w-10 h-10 rounded-2xl bg-[var(--color-background)] flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                  描述你的创意构想<br />AI 自动设定参数
                </p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`
                    max-w-[90%] px-3 py-2 rounded-xl text-[12px] leading-relaxed
                    ${msg.role === 'user'
                      ? 'bg-[#5C4A3A] text-white rounded-br-sm'
                      : 'bg-[var(--color-background)] text-[var(--color-text)] rounded-bl-sm border border-[var(--color-border-light)]'
                    }
                  `}>
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    {msg.actions?.triggerGenerate && (
                      <p className="mt-1 text-[10px] opacity-60">⚡ 正在生成...</p>
                    )}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] rounded-bl-sm">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 text-[var(--color-accent)] animate-spin" />
                    <span className="text-[10px] text-[var(--color-text-muted)]">AI 思考中...</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 输入框 */}
          <div className="px-3 py-3 border-t border-[var(--color-border-light)]">
            <div className="flex items-end gap-2 bg-[var(--color-background)] rounded-xl border border-[var(--color-border-light)] px-3 py-2 focus-within:border-[var(--color-accent)]/40 transition-colors">
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述你的需求..."
                rows={2}
                className="flex-1 text-[12px] bg-transparent border-0 focus:ring-0 focus:outline-none resize-none placeholder:text-[var(--color-text-muted)] text-[var(--color-text)]"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="w-7 h-7 rounded-lg bg-[#5C4A3A] text-white flex items-center justify-center hover:bg-[#3D2E20] disabled:opacity-20 transition-all duration-300 flex-shrink-0 mb-0.5"
              >
                {loading
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Send className="w-3 h-3" />
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

export function AIChatBottomBar({ context, onActions, onTriggerGenerate }: Omit<AIChatBoxProps, 'mode'>) {
  const [expanded, setExpanded] = useState(false);
  const { messages, input, setInput, loading, scrollRef, inputRef, handleSend, handleKeyDown } = useAIChat(context, onActions, onTriggerGenerate);

  const QUICK_TAGS = ['产品图', '场景图', '纤细', '白皙'];
  const latestAIMsg = messages.filter(m => m.role === 'ai').at(-1);

  return (
    <div className={`
      lg:hidden fixed bottom-0 left-0 right-0 z-50
      bg-[var(--color-surface)]/95 backdrop-blur-xl
      border-t border-[var(--color-border-light)]
      transition-all duration-400 ease-in-out
      pb-[env(safe-area-inset-bottom)]
    `}>
      {/* 展开时：对话历史区 */}
      {expanded && (
        <div className="border-b border-[var(--color-border-light)]">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[10px] font-medium text-[var(--color-text-muted)] tracking-wide uppercase">AI 对话</span>
            <button onClick={() => setExpanded(false)} className="p-1 rounded-lg hover:bg-[var(--color-background)] transition-colors">
              <X className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            </button>
          </div>
          <div
            ref={scrollRef as React.RefObject<HTMLDivElement>}
            className="max-h-40 overflow-y-auto px-4 pb-3 space-y-2"
          >
            {messages.length === 0 ? (
              <p className="text-[11px] text-[var(--color-text-muted)] text-center py-3">告诉 AI 你的创意构想...</p>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`
                    max-w-[85%] px-3 py-2 rounded-xl text-[12px] leading-relaxed
                    ${msg.role === 'user'
                      ? 'bg-[#5C4A3A] text-white rounded-br-sm'
                      : 'bg-[var(--color-background)] text-[var(--color-text)] rounded-bl-sm border border-[var(--color-border-light)]'
                    }
                  `}>
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)]">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 text-[var(--color-accent)] animate-spin" />
                    <span className="text-[10px] text-[var(--color-text-muted)]">AI 思考中...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 主输入行 */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        {/* AI 图标 + 折叠切换 */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#5C4A3A] to-[#8B6F47] flex items-center justify-center flex-shrink-0"
        >
          {expanded
            ? <ChevronDown className="w-4 h-4 text-[var(--color-accent)]" />
            : <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
          }
        </button>

        {/* 输入框 */}
        <div className="flex-1 flex items-center bg-[var(--color-background)] rounded-xl border border-[var(--color-border-light)] px-3 py-2 focus-within:border-[var(--color-accent)]/40 transition-colors">
          {!expanded && latestAIMsg && !input ? (
            <button
              onClick={() => setExpanded(true)}
              className="flex-1 text-[11px] text-left text-[var(--color-text-muted)] truncate"
            >
              {latestAIMsg.text.slice(0, 40)}...
            </button>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setExpanded(true)}
              placeholder="告诉 AI 你的设想..."
              className="flex-1 text-[12px] bg-transparent border-0 focus:ring-0 focus:outline-none placeholder:text-[var(--color-text-muted)] text-[var(--color-text)]"
            />
          )}
        </div>

        {/* 发送 */}
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="w-9 h-9 rounded-xl bg-[#5C4A3A] text-white flex items-center justify-center hover:bg-[#3D2E20] disabled:opacity-20 transition-all duration-300 flex-shrink-0"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />
          }
        </button>
      </div>

      {/* 快捷标签行 */}
      {!expanded && (
        <div className="px-4 pb-2 flex items-center gap-2">
          <span className="text-[9px] text-[var(--color-text-muted)] tracking-wider uppercase flex-shrink-0">✨ AI</span>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {QUICK_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => { setInput(prev => prev ? `${prev}，${tag}` : tag); setExpanded(true); inputRef.current?.focus(); }}
                className="text-[10px] px-2.5 py-0.5 rounded-full border border-transparent bg-[var(--color-background)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-primary)] transition-all duration-200 whitespace-nowrap"
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
export function AIChatBox({ context, onActions, onTriggerGenerate }: AIChatBoxProps) {
  return (
    <>
      <AIChatSidebar context={context} onActions={onActions} onTriggerGenerate={onTriggerGenerate} />
      <AIChatBottomBar context={context} onActions={onActions} onTriggerGenerate={onTriggerGenerate} />
    </>
  );
}
