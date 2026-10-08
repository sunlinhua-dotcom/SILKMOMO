import assert from 'node:assert/strict';
import test from 'node:test';

const { decideLeaveGuardLink } = await import('../lib/leave-guard.ts');

const here = { origin: 'https://app.example.com', pathname: '/task/12', search: '?redo=1' };

function click(overrides = {}) {
  return {
    href: '/tasks',
    target: null,
    download: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...overrides,
  };
}

test('same-origin plain left click leaves the page: intercepted with a relative target', () => {
  assert.deepEqual(decideLeaveGuardLink(click(), here), { intercept: true, to: '/tasks' });
  assert.deepEqual(
    decideLeaveGuardLink(click({ href: 'https://app.example.com/lookbook?x=1#top' }), here),
    { intercept: true, to: '/lookbook?x=1#top' },
  );
  assert.deepEqual(decideLeaveGuardLink(click({ href: '../task/13' }), here), { intercept: true, to: '/task/13' });
  assert.deepEqual(decideLeaveGuardLink(click({ target: '_self' }), here), { intercept: true, to: '/tasks' });
});

test('modifier keys and non-primary buttons never leave the current page', () => {
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.equal(decideLeaveGuardLink(click({ [key]: true }), here).intercept, false, key);
  }
  assert.equal(decideLeaveGuardLink(click({ button: 1 }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ button: 2 }), here).intercept, false);
});

test('target=_blank, download links and already-handled clicks are not intercepted', () => {
  assert.equal(decideLeaveGuardLink(click({ target: '_blank' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ target: '_top' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ download: true }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ defaultPrevented: true }), here).intercept, false);
});

test('hash-only changes and links to the current page are not intercepted', () => {
  assert.equal(decideLeaveGuardLink(click({ href: '#results' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: '/task/12?redo=1#results' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: '/task/12?redo=1' }), here).intercept, false);
  // same path with a different query is a different page state: intercepted
  assert.deepEqual(decideLeaveGuardLink(click({ href: '/task/12' }), here), { intercept: true, to: '/task/12' });
});

test('cross-origin, non-http protocols and empty hrefs are not intercepted', () => {
  assert.equal(decideLeaveGuardLink(click({ href: 'https://other.example.org/x' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: 'mailto:a@b.c' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: 'tel:123' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: 'javascript:void(0)' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: '' }), here).intercept, false);
  assert.equal(decideLeaveGuardLink(click({ href: null }), here).intercept, false);
});
