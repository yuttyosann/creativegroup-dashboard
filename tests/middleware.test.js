'use strict';

const { requireAuth, requireRole, getRoleFromEmail } = require('../middleware/auth');

// ── getRoleFromEmail のテスト ──────────────────────────────
describe('getRoleFromEmail', () => {
  test('登録済みメールのロールを返す', () => {
    expect(getRoleFromEmail('owner@example.com')).toBe('owner');
  });

  test('未登録メールは null を返す', () => {
    expect(getRoleFromEmail('unknown@example.com')).toBeNull();
  });
});

// ── requireAuth のテスト ───────────────────────────────────
describe('requireAuth', () => {
  const mockNext = jest.fn();

  beforeEach(() => mockNext.mockClear());

  test('googleUser がセッションにあれば next() を呼ぶ', () => {
    const req = { session: { googleUser: { email: 'owner@example.com', role: 'owner' } } };
    const res = { redirect: jest.fn() };
    requireAuth(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('googleUser がなければ /auth/google にリダイレクト', () => {
    const req = { session: {} };
    const res = { redirect: jest.fn() };
    requireAuth(req, res, mockNext);
    expect(res.redirect).toHaveBeenCalledWith('/auth/google');
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ── requireRole のテスト ──────────────────────────────────
describe('requireRole', () => {
  const mockNext = jest.fn();

  beforeEach(() => mockNext.mockClear());

  test('許可ロールなら next() を呼ぶ', () => {
    const req = { session: { googleUser: { role: 'owner' } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireRole(['owner', 'manager'])(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test('許可外ロールなら 403 を返す', () => {
    const req = { session: { googleUser: { role: 'staff' } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireRole(['owner', 'manager'])(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
