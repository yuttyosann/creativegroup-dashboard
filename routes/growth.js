'use strict';
/**
 * routes/growth.js
 * グロースハック施策CRUD API
 *
 *   GET    /initiatives        施策一覧（ICEスコア降順）
 *   POST   /initiatives        施策を追加
 *   PUT    /initiatives/:id    施策を更新
 *   DELETE /initiatives/:id    施策を削除
 *   GET    /kpi               KPIサマリー（BigQueryまたはモック）
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const router = express.Router();

const INITIATIVES_FILE = process.env.INITIATIVES_FILE
  || path.join(__dirname, '..', 'data', 'initiatives.json');

function loadInitiatives() {
  try {
    return JSON.parse(fs.readFileSync(INITIATIVES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveInitiatives(data) {
  fs.writeFileSync(INITIATIVES_FILE, JSON.stringify(data, null, 2));
}

function calcIce(impact, confidence, ease) {
  return Math.round(((impact + confidence + ease) / 3) * 10) / 10;
}

// GET /initiatives
router.get('/initiatives', (req, res) => {
  const list = loadInitiatives().sort((a, b) => b.iceScore - a.iceScore);
  res.json(list);
});

// POST /initiatives
router.post('/initiatives', (req, res) => {
  const { title, impact, confidence, ease, status, description } = req.body;
  if (!title || impact == null || confidence == null || ease == null) {
    return res.status(400).json({ error: 'title, impact, confidence, ease は必須です' });
  }
  const initiative = {
    id:          crypto.randomUUID(),
    title,
    description: description || '',
    impact:      Number(impact),
    confidence:  Number(confidence),
    ease:        Number(ease),
    iceScore:    calcIce(Number(impact), Number(confidence), Number(ease)),
    status:      status || 'idea',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    createdBy:   req.session?.googleUser?.email || 'unknown',
  };
  const list = loadInitiatives();
  list.push(initiative);
  saveInitiatives(list);
  res.status(201).json(initiative);
});

// PUT /initiatives/:id
router.put('/initiatives/:id', (req, res) => {
  const list = loadInitiatives();
  const idx  = list.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '施策が見つかりません' });

  const updated = { ...list[idx], ...req.body, updatedAt: new Date().toISOString() };
  if (req.body.impact != null || req.body.confidence != null || req.body.ease != null) {
    updated.iceScore = calcIce(updated.impact, updated.confidence, updated.ease);
  }
  list[idx] = updated;
  saveInitiatives(list);
  res.json(updated);
});

// DELETE /initiatives/:id
router.delete('/initiatives/:id', (req, res) => {
  const list    = loadInitiatives();
  const newList = list.filter(i => i.id !== req.params.id);
  if (newList.length === list.length) {
    return res.status(404).json({ error: '施策が見つかりません' });
  }
  saveInitiatives(newList);
  res.json({ ok: true });
});

// GET /kpi — モックデータを返す（BigQuery連携はPhase 1後半で実装）
router.get('/kpi', (req, res) => {
  const initiatives = loadInitiatives();
  res.json({
    monthlySales:     null,
    newDeals:         null,
    retentionRate:    null,
    roas:             null,
    activeInitiatives: initiatives.filter(i => i.status === 'in_progress').length,
    funnel: {
      acquisition: null,
      interest:    null,
      conversion:  null,
      retention:   null,
      revenue:     null,
    },
    _mock: true,
    _message: 'BigQuery連携前のモックデータです',
  });
});

module.exports = router;
