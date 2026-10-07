import assert from 'node:assert/strict';
import test from 'node:test';

const { formatRelativeTime } = await import('../lib/format-time.ts');

const NOW = new Date('2026-10-08T12:00:00+08:00').getTime();
const ago = (ms) => NOW - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('不足 1 分钟与未来时间都是「刚刚」', () => {
  assert.equal(formatRelativeTime(NOW, NOW), '刚刚');
  assert.equal(formatRelativeTime(ago(59_999), NOW), '刚刚');
  assert.equal(formatRelativeTime(NOW + 5 * MIN, NOW), '刚刚');
});

test('分钟 / 小时 / 天的边界', () => {
  assert.equal(formatRelativeTime(ago(MIN), NOW), '1分钟前');
  assert.equal(formatRelativeTime(ago(59 * MIN + 59_000), NOW), '59分钟前');
  assert.equal(formatRelativeTime(ago(HOUR), NOW), '1小时前');
  assert.equal(formatRelativeTime(ago(23 * HOUR + 59 * MIN), NOW), '23小时前');
  assert.equal(formatRelativeTime(ago(DAY), NOW), '1天前');
  assert.equal(formatRelativeTime(ago(6 * DAY + 23 * HOUR), NOW), '6天前');
});

test('7 天及更早显示「M月D日」，与 TaskList 旧实现一致', () => {
  const old = ago(7 * DAY);
  const expected = new Date(old).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  assert.equal(formatRelativeTime(old, NOW), expected);
  assert.match(expected, /\d+月\d+日/);
});

test('接受 Date / number / ISO 字符串，且结果一致', () => {
  const t = ago(3 * HOUR);
  assert.equal(formatRelativeTime(new Date(t), NOW), '3小时前');
  assert.equal(formatRelativeTime(t, NOW), '3小时前');
  assert.equal(formatRelativeTime(new Date(t).toISOString(), NOW), '3小时前');
});

test('无法解析的输入返回空串', () => {
  assert.equal(formatRelativeTime('not-a-date', NOW), '');
  assert.equal(formatRelativeTime(NaN, NOW), '');
});

test('省略 now 时用当前时间', () => {
  assert.equal(formatRelativeTime(Date.now()), '刚刚');
});
