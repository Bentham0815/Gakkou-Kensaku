/* 学校情報・口コミ検索アプリ（読み取り専用） */
"use strict";

const state = {
  data: null,
  factsBySchool: new Map(),
  reviewsBySchool: new Map(),
  addressBySchool: new Map(),
  deepdiveBySchool: new Map(),
  deviationScoresBySchool: new Map(),
  deviationStatusBySchool: new Map(),
  progressionResultsBySchool: new Map(),
  progressionStatusBySchool: new Map(),
  currentSchool: null,
  sentimentFilter: "",
  reportCache: new Map(),
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- 初期化 ---------- */

async function fetchJsonWithFallback(paths) {
  for (const p of paths) {
    try {
      const res = await fetch(p);
      if (res.ok) return await res.json();
    } catch (e) { /* 次の候補へ */ }
  }
  return null;
}

async function init() {
  // 埋め込みデータ(単一ファイル版) → ローカルAPI → 静的サイトのdata.json の順で探す
  if (window.__STATIC_DATA__) {
    state.data = window.__STATIC_DATA__;
  } else {
    state.data = await fetchJsonWithFallback(["/api/data", "data.json"]);
  }
  if (!state.data || !state.data.schools) {
    $("main").innerHTML = '<p class="empty-note">データを読み込めませんでした。サーバーが起動しているか確認してください。</p>';
    return;
  }

  if (state.data.mode === "mirror") {
    document.querySelector(".subtitle").textContent =
      `保存済みデータのみ・読み取り専用 ／ ミラーコピー表示（同期: ${state.data.mirror_synced_at || "不明"}。最新化は sync_mirror.py）`;
  } else if (state.data.mode === "static") {
    document.querySelector(".subtitle").textContent =
      `保存済みデータのみ・読み取り専用 ／ 公開スナップショット（書き出し: ${state.data.published_at || "不明"}）`;
  }

  indexData();
  renderBanner();
  buildFilters();
  renderSchoolList();
  renderSystemFacts();
  bindEvents();
}

function indexData() {
  const d = state.data;
  for (const f of d.facts) {
    if (!state.factsBySchool.has(f.school_id)) state.factsBySchool.set(f.school_id, []);
    state.factsBySchool.get(f.school_id).push(f);
    // 住所は field=住所 のほか 住所_西校舎 のような別名も拾う
    if ((f.field === "住所" || f.field.startsWith("住所_")) && f.value && f.value !== "未確認") {
      const label = f.field === "住所" ? f.value : `${f.value}（${f.field.slice(3)}）`;
      const prev = state.addressBySchool.get(f.school_id);
      state.addressBySchool.set(f.school_id, prev ? prev + " ／ " + label : label);
    }
  }
  for (const r of d.reviews) {
    if (!state.reviewsBySchool.has(r.school_id)) state.reviewsBySchool.set(r.school_id, []);
    state.reviewsBySchool.get(r.school_id).push(r);
  }
  for (const q of d.deepdive || []) {
    if (!state.deepdiveBySchool.has(q.school_id)) state.deepdiveBySchool.set(q.school_id, []);
    state.deepdiveBySchool.get(q.school_id).push(q);
  }
  for (const s of d.deviation_scores || []) {
    if (!state.deviationScoresBySchool.has(s.school_id)) state.deviationScoresBySchool.set(s.school_id, []);
    state.deviationScoresBySchool.get(s.school_id).push(s);
  }
  for (const q of d.deviation_queue || []) state.deviationStatusBySchool.set(q.school_id, q.status);
  for (const r of d.progression_results || []) {
    if (!state.progressionResultsBySchool.has(r.school_id)) state.progressionResultsBySchool.set(r.school_id, []);
    state.progressionResultsBySchool.get(r.school_id).push(r);
  }
  for (const q of d.progression_queue || []) state.progressionStatusBySchool.set(q.school_id, q.status);
}

/* ---------- チェック結果バナー ---------- */

function renderBanner() {
  const check = state.data.check;
  const el = $("checkBanner");
  el.hidden = false;
  let cls = "unknown";
  let head = "チェック結果を読み取れませんでした。データの品質状態は不明です。";
  if (check.available) {
    if (check.verdict.includes("差し戻し")) {
      cls = "rejected";
      head = `⚠️ このデータはチェック差し戻し中です（確認日: ${esc(check.checked_date)}）。受験判断に使える完成情報として断定できません。`;
    } else if (check.verdict.includes("合格")) {
      cls = "passed";
      head = `✅ この情報は最新チェックで検索投入判定: 合格の対象です（確認日: ${esc(check.checked_date)}）。`;
    } else {
      head = `チェック結果: 検索投入判定 ${esc(check.verdict)}（確認日: ${esc(check.checked_date)}）`;
    }
  }
  el.className = "check-banner " + cls;
  const pText = Object.entries(check.p_counts || {})
    .map(([k, v]) => `${k}: ${v}`).join(" / ");
  el.innerHTML = `
    <div class="banner-head">${head}<span class="toggle-hint">▼ くわしく</span></div>
    <div class="banner-detail" hidden>
      ${pText ? `<div>${esc(pText)}</div>` : ""}
      <ul>${(check.summary_lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    </div>`;
  el.addEventListener("click", () => {
    const detail = el.querySelector(".banner-detail");
    detail.hidden = !detail.hidden;
    el.querySelector(".toggle-hint").textContent = detail.hidden ? "▼ くわしく" : "▲ とじる";
  });
}

function isRejected() {
  return state.data.check.available && state.data.check.verdict.includes("差し戻し");
}

/* ---------- フィルタ構築 ---------- */

function fillSelect(id, values) {
  const sel = $(id);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function buildFilters() {
  const schools = state.data.schools;
  const uniq = (key) =>
    [...new Set(schools.map((s) => s[key]).filter((v) => v && v !== "未確認"))].sort();
  fillSelect("filterOwnership", uniq("ownership"));
  fillSelect("filterGender", uniq("gender"));
  fillSelect("filterForm", uniq("school_form"));
  fillSelect("filterMunicipality", uniq("municipality"));

  const cats = [...new Set(state.data.reviews.map((r) => r.category).filter(Boolean))].sort();
  fillSelect("filterReviewCategory", cats);

  const chipRow = $("sentimentChips");
  const opts = [["", "すべて"], ["肯定的", "肯定的"], ["混在", "混在"], ["否定的", "否定的"]];
  chipRow.innerHTML = opts
    .map(([v, label], i) => `<button class="chip${i === 0 ? " active" : ""}" data-sent="${v}">${label}</button>`)
    .join("");
  chipRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.sentimentFilter = btn.dataset.sent;
    chipRow.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === btn));
    renderReviewSearch();
  });
}

/* ---------- 学校一覧 ---------- */

function sentimentClass(s) {
  if (s === "肯定的") return "pos";
  if (s === "否定的") return "neg";
  return "mix";
}

function sentimentDots(reviews) {
  const order = { 肯定的: "dot-pos", 混在: "dot-mix", 否定的: "dot-neg" };
  return reviews
    .map((r) => `<span class="${order[r.sentiment] || "dot-mix"}">●</span>`)
    .join("");
}

function renderSchoolList() {
  const q = $("schoolQuery").value.trim();
  const own = $("filterOwnership").value;
  const gen = $("filterGender").value;
  const form = $("filterForm").value;
  const muni = $("filterMunicipality").value;
  const hasRev = $("filterHasReviews").checked;
  const sort = $("sortSchools").value;

  let list = state.data.schools.filter((s) => {
    if (q && !(s.school_name || "").includes(q) && !(s.school_id || "").includes(q)) return false;
    if (own && s.ownership !== own) return false;
    if (gen && s.gender !== gen) return false;
    if (form && s.school_form !== form) return false;
    if (muni && s.municipality !== muni) return false;
    if (hasRev && !state.reviewsBySchool.has(s.school_id)) return false;
    return true;
  });

  if (sort === "reviews") {
    list = list.slice().sort((a, b) =>
      (state.reviewsBySchool.get(b.school_id)?.length || 0) -
      (state.reviewsBySchool.get(a.school_id)?.length || 0));
  } else {
    list = list.slice().sort((a, b) => (a.school_name || "").localeCompare(b.school_name || "", "ja"));
  }

  $("schoolCount").textContent = `${list.length}校が見つかりました（登録 ${state.data.schools.length}校）`;

  $("schoolList").innerHTML = list.length
    ? list.map(schoolCardHtml).join("")
    : '<p class="empty-note">条件に合う学校がありません。</p>';
}

function schoolCardHtml(s) {
  const reviews = state.reviewsBySchool.get(s.school_id) || [];
  const addr = state.addressBySchool.get(s.school_id);
  const revBadge = reviews.length
    ? `<span class="badge review-badge">口コミ ${reviews.length}件<span class="sentiment-dots">${sentimentDots(reviews)}</span></span>`
    : '<span class="badge no-review">口コミ未収集</span>';
  const deepdiveBadge = state.deepdiveBySchool.has(s.school_id)
    ? '<span class="badge deepdive-badge">🔍 深掘り中</span>'
    : "";
  const chips = [
    s.ownership && s.ownership !== "未確認" ? `<span class="badge ownership">${esc(s.ownership)}</span>` : "",
    s.school_form && s.school_form !== "未確認" ? `<span class="badge">${esc(s.school_form)}</span>` : "",
    s.gender && s.gender !== "未確認" ? `<span class="badge">${esc(s.gender)}</span>` : "",
    s.municipality && s.municipality !== "未確認"
      ? `<span class="badge">${esc(s.prefecture || "")}${esc(s.municipality)}</span>`
      : (s.prefecture ? `<span class="badge">${esc(s.prefecture)}</span>` : ""),
  ].join("");
  return `
    <div class="school-card" data-sid="${esc(s.school_id)}">
      <h3>${esc(s.school_name)}</h3>
      <div class="badge-row">${revBadge}${deepdiveBadge}${chips}</div>
      <div class="addr">${addr ? esc(addr) : "住所未確認"}</div>
    </div>`;
}

/* ---------- 口コミ横断検索 ---------- */

function reviewCardHtml(r, { withSchoolLink } = {}) {
  const tags = (r.detail_tags || "").split(";").map((t) => t.trim()).filter(Boolean);
  const isX = r.platform === "X";
  // Xは投稿URLにアカウント名が含まれるため表示しない（個人情報保護ルール）
  const link = !isX && r.source_url
    ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_title || r.platform)}</a>`
    : `${esc(r.source_title || r.platform)}${isX ? "（アカウント保護のためURL非表示）" : ""}`;
  const posted = (r.posted_at || "").slice(0, 10);
  const schoolLink = withSchoolLink
    ? `<button class="review-school-link" data-sid="${esc(r.school_id)}">${esc(r.school_name)}</button>`
    : "";
  return `
    <div class="review-card">
      <div class="review-top">
        ${schoolLink}
        <span class="sentiment ${sentimentClass(r.sentiment)}">${esc(r.sentiment)}</span>
        <span class="badge">${esc(r.category)}</span>
        <span class="badge drank">雰囲気情報</span>
      </div>
      <div class="review-summary">${esc(r.summary)}</div>
      ${r.anonymous_episode_summary ? `
      <div class="review-episode">
        <span class="episode-label">生活実感メモ</span>
        <span>${esc(r.anonymous_episode_summary)}</span>
      </div>` : ""}
      ${tags.length ? `<div class="tag-row">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="review-meta">
        ${esc(r.platform)} ／ 投稿: ${esc(posted || "不明")} ／ 収集: ${esc(r.collected_at || "不明")} ／ 出典: ${link}
        ${r.personal_info_removed === "はい" ? " ／ 個人情報除去済み" : ""}
      </div>
    </div>`;
}

function renderReviewSearch() {
  const q = $("reviewQuery").value.trim();
  const cat = $("filterReviewCategory").value;
  const terms = q.split(/[\s　]+/).filter(Boolean);

  const list = state.data.reviews.filter((r) => {
    if (state.sentimentFilter && r.sentiment !== state.sentimentFilter) return false;
    if (cat && r.category !== cat) return false;
    if (terms.length) {
      const hay = [r.school_name, r.summary, r.anonymous_episode_summary, r.category,
        r.detail_tags, r.observed_context].join(" ");
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const counts = { 肯定的: 0, 混在: 0, 否定的: 0 };
  for (const r of list) if (r.sentiment in counts) counts[r.sentiment]++;
  const breakdown = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s}${n}`)
    .join("・");
  $("reviewCount").textContent =
    `${list.length}件の口コミ要約（全${state.data.reviews.length}件・${state.reviewsBySchool.size}校分）` +
    (breakdown ? ` — ${breakdown}` : "");
  $("reviewList").innerHTML = list.length
    ? list.map((r) => reviewCardHtml(r, { withSchoolLink: true })).join("")
    : '<p class="empty-note">条件に合う口コミがありません。</p>';
}

/* ---------- 学校詳細 ---------- */

const FACT_GROUPS = [
  ["入試情報", /入試|出願|試験|募集|合格|倍率|検定料|得点|過去問|繰上|入学者決定|入学条件|適性検査/],
  ["学力指標", /偏差値|ランキング/],
  ["学費・支援", /授業料|入学料|入学金|施設費|費用|奨学金|支援|特待/],
  ["通学・生活", /最寄り|通学|バス|寮|学期|制服|部活|行事|授業時程|使用言語|時程|給食/],
  ["進路", /進学|進路|大学|就職|卒業/],
  ["基本情報", /住所|電話|名称|学校種別|設置者|男女|学校段階|対象学年|公式|特色|宗教|理念|沿革|創立/],
];

function groupFacts(facts) {
  const groups = new Map(FACT_GROUPS.map(([name]) => [name, []]));
  groups.set("その他", []);
  for (const f of facts) {
    let placed = false;
    for (const [name, re] of FACT_GROUPS) {
      if (re.test(f.field)) { groups.get(name).push(f); placed = true; break; }
    }
    if (!placed) groups.get("その他").push(f);
  }
  const order = ["基本情報", "入試情報", "学力指標", "学費・支援", "通学・生活", "進路", "その他"];
  return order.map((name) => [name, groups.get(name)]).filter(([, v]) => v.length);
}

// 内部記号(A/B/C/D)は人に伝わらないため、画面では日本語ラベルに置き換える
const CONF_LABELS = { A: "公式確認", B: "確認済み", C: "参考", D: "参考" };

function confBadge(f) {
  const unverified = f.confidence === "未確認" || f.source_id === "SRC-UNVERIFIED" || f.value === "未確認";
  if (unverified) return '<span class="conf U">未確認</span>';
  const c = (f.confidence || "").toUpperCase();
  const cls = ["A", "B", "C", "D"].includes(c) ? c : "U";
  const label = CONF_LABELS[c] || esc(f.confidence || "不明");
  return `<span class="conf ${cls}" title="確度${esc(c)}">${label}</span>`;
}

function factRowHtml(f) {
  const src = state.data.sources[f.source_id];
  const unverified = f.confidence === "未確認" || f.source_id === "SRC-UNVERIFIED" || f.value === "未確認";
  let srcHtml;
  if (src && src.url) {
    srcHtml = `出典: <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>（${esc(src.publisher || "")} / 確認日 ${esc(f.checked_at || src.accessed_at || "不明")}）`;
  } else if (unverified) {
    srcHtml = "出典なし（未確認情報）";
  } else {
    srcHtml = `出典ID: ${esc(f.source_id)} / 確認日 ${esc(f.checked_at || "不明")}`;
  }
  return `
    <tr>
      <th>${esc(f.field)}</th>
      <td>
        <span class="fact-value${unverified ? " unverified" : ""}">${esc(f.value)}</span>${confBadge(f)}
        <div class="fact-source">${srcHtml}</div>
        ${f.notes ? `<div class="fact-note">メモ: ${esc(f.notes)}</div>` : ""}
      </td>
    </tr>`;
}

function openSchool(sid) {
  const s = state.data.schools.find((x) => x.school_id === sid);
  if (!s) return;
  state.currentSchool = s;

  showView("viewDetail");
  window.scrollTo(0, 0);

  const addr = state.addressBySchool.get(sid);
  const rejectedNote = isRejected()
    ? '<div class="notice-d" style="margin-top:10px">この学校情報は現在チェック差し戻し中です。以下は既存ファイルにある暫定情報です。</div>'
    : "";
  $("detailHead").innerHTML = `
    <div class="detail-head">
      <h2>${esc(s.school_name)}</h2>
      <div class="badge-row">
        ${s.ownership ? `<span class="badge ownership">${esc(s.ownership)}</span>` : ""}
        ${s.school_form ? `<span class="badge">${esc(s.school_form)}</span>` : ""}
        ${s.gender && s.gender !== "未確認" ? `<span class="badge">${esc(s.gender)}</span>` : '<span class="badge">男女区分 未確認</span>'}
        ${s.grade_range && s.grade_range !== "未確認" ? `<span class="badge">${esc(s.grade_range)}</span>` : ""}
        ${s.target_exam ? `<span class="badge">${esc(s.target_exam)}</span>` : ""}
      </div>
      <div>${addr ? esc(addr) : "住所未確認"}</div>
      ${s.official_url ? `<div class="official-link">公式サイト: <a href="${esc(s.official_url)}" target="_blank" rel="noopener noreferrer">${esc(s.official_url)}</a></div>` : ""}
      <div class="meta-line">school_id: ${esc(s.school_id)} ／ 最終確認: ${esc(s.last_checked || "不明")}${s.notes ? " ／ " + esc(s.notes) : ""}</div>
      ${rejectedNote}
    </div>`;

  renderDetailReviews(sid);
  renderDetailFacts(sid);
  renderDetailSources(sid);
  renderDetailReport(sid);
  selectTab("reviews");
}

function sentimentSummaryHtml(reviews) {
  const counts = { 肯定的: 0, 混在: 0, 否定的: 0 };
  for (const r of reviews) if (r.sentiment in counts) counts[r.sentiment]++;
  const chips = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `<span class="stat-chip ${sentimentClass(s)}"><span class="stat-dot">●</span>${s} ${n}件</span>`)
    .join("");
  return `<div class="review-stats"><strong>口コミ ${reviews.length}件</strong>${chips}</div>`;
}

function deepdiveHtml(sid) {
  const rows = state.deepdiveBySchool.get(sid) || [];
  if (!rows.length) return "";
  const chips = rows
    .map((q) => `<span class="lens-chip">${esc(q.selection_lens)} <b>${esc(q.public_candidate_count)}</b></span>`)
    .join("");
  return `
    <div class="deepdive-box">
      <div class="deepdive-title">🔍 口コミ深掘り調査が進行中</div>
      <div class="lens-row">${chips}</div>
      <div class="deepdive-caption">学校選び5観点で公開口コミの候補を集めた件数です（キーワードによる粗分類の段階）。
      読み込んだうえでの観点別の要約は、これから順次追加されます。</div>
    </div>`;
}

function renderDetailReviews(sid) {
  const reviews = state.reviewsBySchool.get(sid) || [];
  const head = `
    <div class="notice-d" style="margin-bottom:12px">
      <strong>口コミ・SNSで見える雰囲気</strong> — あくまで雰囲気の参考情報です。公式事実ではなく、
      住所・倍率・学費・進学実績・入試条件の根拠には使えません。
    </div>`;
  const body = reviews.length
    ? sentimentSummaryHtml(reviews) + `<div class="review-list">${reviews.map((r) => reviewCardHtml(r)).join("")}</div>`
    : '<p class="empty-note">この学校の口コミ・SNS要約はまだ収集されていません（review_queue待ち）。</p>';
  $("tabReviews").innerHTML = head + body + deepdiveHtml(sid);
}

function citationHtml(sourceId) {
  const src = state.data.sources[sourceId];
  if (!src) return "―";
  return src.url
    ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.publisher || src.title)}</a>`
    : esc(src.publisher || src.title || "―");
}

function deviationSectionHtml(sid) {
  const rows = state.deviationScoresBySchool.get(sid) || [];
  const status = state.deviationStatusBySchool.get(sid);
  if (!rows.length && !status) return "";
  const body = rows.length
    ? `<div class="fact-table-wrap"><table class="mini-table">
        <thead><tr><th>提供元</th><th>性別</th><th>種別</th><th>偏差値</th><th>年度</th><th>出典</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td>${esc(r.provider_name)}</td><td>${esc(r.gender)}</td><td>${esc(r.score_kind)}</td>
            <td class="num">${esc(r.score_value)}</td><td>${esc(r.source_year_label)}</td>
            <td>${citationHtml(r.source_id)}</td>
          </tr>`).join("")}</tbody>
      </table></div>`
    : '<p class="empty-note" style="padding:14px 16px">この学校の偏差値はまだ確認できていません。</p>';
  return `
    <div class="fact-group">
      <h3>偏差値（提供元別）</h3>
      ${body}
      ${status ? `<div class="fact-note" style="padding:8px 16px 12px">確認状況: ${esc(status)}</div>` : ""}
    </div>`;
}

function progressionSectionHtml(sid) {
  const rows = state.progressionResultsBySchool.get(sid) || [];
  const status = state.progressionStatusBySchool.get(sid);
  if (!rows.length && !status) return "";
  const sorted = rows.slice().sort((a, b) => b.result_year.localeCompare(a.result_year));
  const body = sorted.length
    ? `<div class="fact-table-wrap"><table class="mini-table">
        <thead><tr><th>年度</th><th>区分</th><th>大学等</th><th>現役+浪人</th><th>現役</th><th>出典</th></tr></thead>
        <tbody>${sorted.map((r) => `
          <tr>
            <td>${esc(r.result_year)}</td><td>${esc(r.category)}</td><td>${esc(r.university_name || "―")}</td>
            <td class="num">${esc(r.count_total || "―")}</td><td class="num">${esc(r.count_active || "―")}</td>
            <td>${citationHtml(r.source_id)}</td>
          </tr>`).join("")}</tbody>
      </table></div>`
    : '<p class="empty-note" style="padding:14px 16px">この学校の進学実績はまだ確認できていません。</p>';
  return `
    <div class="fact-group">
      <h3>進学実績（大学合格者数）</h3>
      ${body}
      <div class="fact-note" style="padding:8px 16px 2px">合格者数であり、進学者数ではありません（延べ人数）。</div>
      ${status ? `<div class="fact-note" style="padding:2px 16px 12px">確認状況: ${esc(status)}</div>` : ""}
    </div>`;
}

function renderDetailFacts(sid) {
  const facts = state.factsBySchool.get(sid) || [];
  if (!facts.length) {
    $("tabFacts").innerHTML = '<p class="empty-note">この学校の事実データはまだありません。</p>';
    return;
  }
  const unverified = facts.filter(
    (f) => f.confidence === "未確認" || f.source_id === "SRC-UNVERIFIED" || f.value === "未確認");
  const unverifiedBox = unverified.length
    ? `<div class="unverified-box"><strong>未確認項目（${unverified.length}件）</strong> — 検索エンジンの確定情報としてはまだ使えません。
        <ul>${unverified.map((f) => `<li>${esc(f.field)}</li>`).join("")}</ul></div>`
    : "";
  const groups = groupFacts(facts);
  const groupsHtml = groups
    .map(([name, list]) => `
      <div class="fact-group">
        <h3>${esc(name)}</h3>
        <div class="fact-table-wrap"><table class="fact-table"><tbody>
          ${list.map(factRowHtml).join("")}
        </tbody></table></div>
      </div>`)
    .join("");
  $("tabFacts").innerHTML =
    unverifiedBox + groupsHtml + deviationSectionHtml(sid) + progressionSectionHtml(sid);
}

function renderDetailSources(sid) {
  const facts = state.factsBySchool.get(sid) || [];
  const reviews = state.reviewsBySchool.get(sid) || [];
  const ids = [...new Set([...facts, ...reviews].map((x) => x.source_id).filter(Boolean))];
  const rows = ids
    .map((id) => ({ id, src: state.data.sources[id] }))
    .filter((x) => x.src);
  if (!rows.length) {
    $("tabSources").innerHTML = '<p class="empty-note">この学校に紐づく出典はまだありません。</p>';
    return;
  }
  $("tabSources").innerHTML = `
    <div class="source-table-wrap"><table class="source-table">
      <thead><tr><th>種別</th><th>タイトル</th><th>発行元</th><th>確認日</th><th>メモ</th></tr></thead>
      <tbody>
        ${rows.map(({ id, src }) => {
          const isXSource = /x\.com|twitter\.com/.test(src.url || "");
          const title = src.url && !isXSource
            ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>`
            : `${esc(src.title)}${isXSource ? "（アカウント保護のためURL非表示）" : ""}`;
          const rank = (src.source_rank || "?").toUpperCase();
          const rankLabels = { A: "公式", B: "準公式", C: "参考", D: "口コミ・SNS" };
          return `<tr>
            <td><span class="rank-pill ${["A","B","C","D"].includes(rank) ? rank : "C"}" title="出典ランク${esc(rank)}">${rankLabels[rank] || esc(src.source_rank || "不明")}</span></td>
            <td>${title}<div class="fact-note">${esc(id)}</div></td>
            <td>${esc(src.publisher || "")}</td>
            <td>${esc(src.accessed_at || "")}</td>
            <td>${esc(src.notes || "")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table></div>`;
}

async function renderDetailReport(sid) {
  const el = $("tabReport");
  const avail = state.data.reports[sid] || {};
  if (!avail.report && !avail.designed) {
    el.innerHTML = '<p class="empty-note">この学校のレポートはまだありません。</p>';
    return;
  }
  el.innerHTML = '<p class="empty-note">読み込み中…</p>';
  let payload = state.reportCache.get(sid);
  if (!payload) {
    if (state.data.report_payloads) {
      // 単一ファイル版: レポート本文も埋め込み済み
      payload = state.data.report_payloads[sid] || { report: null, designed: null };
    } else {
      payload = await fetchJsonWithFallback([
        "/api/report?school_id=" + encodeURIComponent(sid),
        "reports/" + sid + ".json",
      ]);
    }
    if (!payload) {
      el.innerHTML = '<p class="empty-note">レポートを読み込めませんでした。</p>';
      return;
    }
    state.reportCache.set(sid, payload);
  }
  if (state.currentSchool?.school_id !== sid) return;

  const notice = '<div class="notice-d" style="margin-bottom:12px">レポートは表示補助です。事実確認はCSVと出典を優先してください。</div>';
  const buttons = [];
  if (payload.designed) buttons.push('<button class="chip active" data-rep="designed">1ページ版（読みやすい）</button>');
  if (payload.report) buttons.push(`<button class="chip${payload.designed ? "" : " active"}" data-rep="report">詳細レポート</button>`);
  el.innerHTML = `${notice}<div class="report-select">${buttons.join("")}</div><div class="md-body" id="mdBody"></div>`;

  const show = (which) => {
    $("mdBody").innerHTML = renderMarkdown(payload[which] || "");
    el.querySelectorAll(".report-select .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.rep === which));
  };
  el.querySelector(".report-select").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (btn) show(btn.dataset.rep);
  });
  show(payload.designed ? "designed" : "report");
}

/* ---------- 制度・全体データ ---------- */

function renderSystemFacts() {
  const aggIds = [...state.factsBySchool.keys()].filter((k) => k.startsWith("ALL_"));
  if (!aggIds.length) {
    $("systemFacts").innerHTML = '<p class="empty-note">全体データはありません。</p>';
    return;
  }
  const labels = {
    ALL_TOKYO_PUBLIC: "東京都の公立学校 全体",
    ALL_TORITSU_CHUKO_IKKAN: "都立中高一貫教育校 制度",
  };
  $("systemFacts").innerHTML = aggIds
    .map((id) => `
      <div class="fact-group">
        <h3>${esc(labels[id] || id)}</h3>
        <div class="fact-table-wrap"><table class="fact-table"><tbody>
          ${(state.factsBySchool.get(id) || []).map(factRowHtml).join("")}
        </tbody></table></div>
      </div>`)
    .join("");
}

/* ---------- 簡易Markdownレンダラ ---------- */

function inlineMd(s) {
  let out = esc(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

function renderMarkdown(text) {
  const lines = text.split("\n");
  const html = [];
  let list = null; // "ul" | "ol"
  let table = null; // {header, rows}

  const closeList = () => {
    if (list) { html.push(`</${list}>`); list = null; }
  };
  const closeTable = () => {
    if (table) {
      html.push('<div class="md-table-wrap"><table>');
      html.push("<thead><tr>" + table.header.map((c) => `<th>${inlineMd(c)}</th>`).join("") + "</tr></thead>");
      html.push("<tbody>" + table.rows.map((r) =>
        "<tr>" + r.map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>").join("") + "</tbody>");
      html.push("</table></div>");
      table = null;
    }
  };
  const splitRow = (line) =>
    line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const cells = splitRow(line);
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 区切り行
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    closeTable();

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      html.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) { closeList(); html.push("<hr>"); continue; }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
      html.push(`<li>${inlineMd((ul || ol)[1])}</li>`);
      continue;
    }
    closeList();

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) { html.push(`<blockquote>${inlineMd(bq[1])}</blockquote>`); continue; }

    if (line.trim() === "") continue;
    html.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList();
  closeTable();
  return html.join("\n");
}

/* ---------- 画面切替・イベント ---------- */

function showView(id) {
  for (const v of ["viewSchools", "viewReviews", "viewSystem", "viewDetail"]) {
    $(v).hidden = v !== id;
  }
  const modeMap = { viewSchools: "modeSchools", viewReviews: "modeReviews", viewSystem: "modeSystem" };
  for (const [view, btn] of Object.entries(modeMap)) {
    $(btn).classList.toggle("active", view === id);
  }
}

function selectTab(name) {
  document.querySelectorAll("#detailTabs .tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  $("tabReviews").hidden = name !== "reviews";
  $("tabFacts").hidden = name !== "facts";
  $("tabSources").hidden = name !== "sources";
  $("tabReport").hidden = name !== "report";
}

function bindEvents() {
  $("modeSchools").addEventListener("click", () => showView("viewSchools"));
  $("modeReviews").addEventListener("click", () => { showView("viewReviews"); renderReviewSearch(); });
  $("modeSystem").addEventListener("click", () => showView("viewSystem"));

  for (const id of ["schoolQuery"]) $(id).addEventListener("input", renderSchoolList);
  for (const id of ["filterOwnership", "filterGender", "filterForm", "filterMunicipality", "sortSchools"])
    $(id).addEventListener("change", renderSchoolList);
  $("filterHasReviews").addEventListener("change", renderSchoolList);

  $("reviewQuery").addEventListener("input", renderReviewSearch);
  $("filterReviewCategory").addEventListener("change", renderReviewSearch);

  $("schoolList").addEventListener("click", (e) => {
    const card = e.target.closest(".school-card");
    if (card) openSchool(card.dataset.sid);
  });
  $("reviewList").addEventListener("click", (e) => {
    const link = e.target.closest(".review-school-link");
    if (link) openSchool(link.dataset.sid);
  });
  $("backBtn").addEventListener("click", () => showView("viewSchools"));
  $("detailTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) selectTab(btn.dataset.tab);
  });
}

init();
