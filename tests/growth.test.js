'use strict';

const request  = require('supertest');
const express  = require('express');
const session  = require('express-session');
const fs       = require('fs');
const path     = require('path');

// テスト用の一時ファイルを使う
const TMP_FILE = path.join(__dirname, 'tmp-initiatives.json');
process.env.INITIATIVES_FILE = TMP_FILE;

const growthRouter = require('../routes/growth');

function buildApp(role = 'owner') {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.session.googleUser = { email: 'test@test.com', role };
    next();
  });
  app.use('/', growthRouter);
  return app;
}

beforeEach(() => {
  fs.writeFileSync(TMP_FILE, JSON.stringify([]));
});

afterAll(() => {
  if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
});

describe('GET /initiatives', () => {
  test('空のリストを返す', async () => {
    const res = await request(buildApp()).get('/initiatives');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /initiatives', () => {
  test('施策を追加してIDを返す', async () => {
    const payload = { title: 'テスト施策', impact: 8, confidence: 7, ease: 6, status: 'idea' };
    const res = await request(buildApp()).post('/initiatives').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.iceScore).toBeCloseTo(7.0);
  });

  test('必須フィールド欠落で 400 を返す', async () => {
    const res = await request(buildApp()).post('/initiatives').send({ title: '不完全' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /initiatives/:id', () => {
  test('ステータスを更新できる', async () => {
    const create = await request(buildApp()).post('/initiatives')
      .send({ title: '更新テスト', impact: 5, confidence: 5, ease: 5, status: 'idea' });
    const id = create.body.id;
    const update = await request(buildApp()).put(`/initiatives/${id}`).send({ status: 'in_progress' });
    expect(update.status).toBe(200);
    expect(update.body.status).toBe('in_progress');
  });
});

describe('DELETE /initiatives/:id', () => {
  test('施策を削除できる', async () => {
    const create = await request(buildApp()).post('/initiatives')
      .send({ title: '削除テスト', impact: 5, confidence: 5, ease: 5, status: 'idea' });
    const id = create.body.id;
    const del = await request(buildApp()).delete(`/initiatives/${id}`);
    expect(del.status).toBe(200);
    const list = await request(buildApp()).get('/initiatives');
    expect(list.body).toHaveLength(0);
  });
});
