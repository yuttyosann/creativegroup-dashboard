// Notion 読み書き（候補プールDB / シード設定DB）
const TOKEN = () => process.env.NOTION_TOKEN;
const CAND_DB = () => process.env.CANDIDATE_DB_ID;
const SEED_DB = () => process.env.SEED_DB_ID;

// シグナル → DBプロパティ名の対応
export const SIGNAL_FIELDS = {
  sns:    { point: "SNS話題量_点",   evidence: "SNS_根拠",   label: "SNS話題量" },
  search: { point: "検索の伸び_点",   evidence: "検索_根拠",   label: "検索の伸び" },
  media:  { point: "メディア掲載_点", evidence: "メディア_根拠", label: "メディア掲載" },
};

async function notion(path, { method = "GET", body } = {}) {
  const res = await fetch("https://api.notion.com/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + TOKEN(),
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

const plain = (rich) => (rich || []).map((r) => r.plain_text).join("");

/** 候補プールDBの一覧（アーカイブ除く） */
export async function listCandidates() {
  const out = [];
  let cursor;
  do {
    const d = await notion(`/databases/${CAND_DB()}/query`, {
      method: "POST",
      body: { page_size: 100, start_cursor: cursor },
    });
    for (const p of d.results) {
      const pr = p.properties;
      out.push({
        id: p.id,
        name: plain(pr["対象名"]?.title),
        category: pr["カテゴリ"]?.select?.name || "",
        inflow: pr["流入経路"]?.select?.name || "",
        stage: pr["段階"]?.select?.name || "",
        points: {
          sns: pr[SIGNAL_FIELDS.sns.point]?.number ?? null,
          search: pr[SIGNAL_FIELDS.search.point]?.number ?? null,
          media: pr[SIGNAL_FIELDS.media.point]?.number ?? null,
        },
      });
    }
    cursor = d.has_more ? d.next_cursor : undefined;
  } while (cursor);
  return out.filter((c) => c.name);
}

/** シード設定DBの一覧 */
export async function listSeeds() {
  const d = await notion(`/databases/${SEED_DB()}/query`, {
    method: "POST",
    body: { page_size: 100 },
  });
  return d.results.map((p) => {
    const pr = p.properties;
    return {
      category: plain(pr["カテゴリ"]?.title),
      seedWords: plain(pr["検索シード語（Trends/News）"]?.rich_text),
      hashtags: plain(pr["ハッシュタグ（TikTok/IG）"]?.rich_text),
      autoOn: pr["自動検索ON"]?.checkbox ?? false,
      memo: plain(pr["メモ"]?.rich_text),
    };
  });
}

/** 候補プールDBに新しい候補を作成（自動生成された候補用） */
export async function createCandidate({ name, category, note }) {
  const props = {
    "対象名": { title: [{ text: { content: String(name).slice(0, 190) } }] },
    "流入経路": { select: { name: "編集部リサーチ" } },
    "段階": { select: { name: "0次" } },
  };
  if (category) props["カテゴリ"] = { select: { name: category } };
  if (note) props["トレンドポイント"] = { rich_text: [{ text: { content: String(note).slice(0, 1990) } }] };
  await notion("/pages", { method: "POST", body: { parent: { database_id: CAND_DB() }, properties: props } });
}

/**
 * シグナルの結果を候補ページに書き戻す。
 * _点は「空欄のときだけ」入れる（編集部の手入力を上書きしない）。_根拠は常に更新。
 */
export async function writeSignal(pageId, signalKey, point, evidence, currentPoint) {
  const f = SIGNAL_FIELDS[signalKey];
  if (!f) throw new Error("unknown signal " + signalKey);
  const props = {};
  if (point != null && (currentPoint == null)) {
    props[f.point] = { number: Number(point) };
  }
  if (evidence != null) {
    props[f.evidence] = { rich_text: [{ text: { content: String(evidence).slice(0, 1990) } }] };
  }
  if (Object.keys(props).length === 0) return { skipped: true };
  await notion(`/pages/${pageId}`, { method: "PATCH", body: { properties: props } });
  return { wrotePoint: props[f.point] != null };
}
