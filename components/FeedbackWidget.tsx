'use client';

/**
 * Phase 4B：生成反馈组件
 * 在每张生成结果下方显示 👍👎 按钮 + 可选文字反馈
 */
import { useState } from 'react';

interface FeedbackWidgetProps {
  recordId: string;
  onFeedback?: (rating: -1 | 1) => void;
}

const FEEDBACK_TAGS = [
  '服装还原好', '光影优秀', '构图完美', '模特自然',
  '服装变形', '光影不对', '构图差', '有文字水印', '面部异常',
];

export function FeedbackWidget({ recordId, onFeedback }: FeedbackWidgetProps) {
  const [rating, setRating] = useState<-1 | 0 | 1>(0);
  const [showDetail, setShowDetail] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!recordId) return null;

  const handleRate = async (newRating: -1 | 1) => {
    setRating(newRating);
    setSubmitting(true);

    try {
      await fetch('/api/generation/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          rating: newRating,
          feedback: '',
          feedbackTags: [],
        }),
      });
      onFeedback?.(newRating);
      
      // 如果是差评，展开详情
      if (newRating === -1) {
        setShowDetail(true);
      } else {
        setSubmitted(true);
      }
    } catch {
      // 静默失败，不影响用户
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitDetail = async () => {
    setSubmitting(true);
    try {
      await fetch('/api/generation/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          rating,
          feedback,
          feedbackTags: selectedTags,
        }),
      });
      setSubmitted(true);
      setShowDetail(false);
    } catch {
      // 静默失败
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  // 下载时标记（隐式正面信号）
  const handleDownloadTrack = async () => {
    try {
      await fetch('/api/generation/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, action: 'download' }),
      });
    } catch {
      // 静默
    }
  };

  if (submitted) {
    return (
      <div className="feedback-widget feedback-submitted">
        <span className="feedback-thank">
          {rating === 1 ? '👍' : '👎'} 感谢反馈
        </span>
      </div>
    );
  }

  return (
    <div className="feedback-widget">
      <div className="feedback-actions">
        <button
          className={`feedback-btn feedback-up ${rating === 1 ? 'active' : ''}`}
          onClick={() => handleRate(1)}
          disabled={submitting}
          title="满意"
        >
          👍
        </button>
        <button
          className={`feedback-btn feedback-down ${rating === -1 ? 'active' : ''}`}
          onClick={() => handleRate(-1)}
          disabled={submitting}
          title="不满意"
        >
          👎
        </button>
        <button
          className="feedback-btn feedback-download"
          onClick={handleDownloadTrack}
          title="标记为已下载"
          style={{ display: 'none' }}  // 由父组件的下载按钮触发
        >
          ⬇️
        </button>
      </div>

      {showDetail && (
        <div className="feedback-detail">
          <div className="feedback-tags">
            {FEEDBACK_TAGS.map(tag => (
              <button
                key={tag}
                className={`feedback-tag ${selectedTags.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          <textarea
            className="feedback-text"
            placeholder="补充说明（可选）"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            rows={2}
          />
          <button
            className="feedback-submit"
            onClick={handleSubmitDetail}
            disabled={submitting}
          >
            {submitting ? '提交中...' : '提交反馈'}
          </button>
        </div>
      )}
    </div>
  );
}
