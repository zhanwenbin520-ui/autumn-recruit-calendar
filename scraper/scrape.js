#!/usr/bin/env node
/* ============================================================
   秋招日历 · 服务器自动抓取脚本（零依赖，Node >= 20）
   数据源：5 所高校就业网共用接口 /f/recruitmentFair/ajax_calendar_list?time=YYYY-MM
   纪律：
   1) 浏览器 UA + Referer，模拟正常访问
   2) 每轮每校仅 2 个请求（当月+次月），站间随机停 4-9 秒，频率低于人工浏览
   3) 请求失败退避重试 1 次；任一站整体失败则本轮放弃推送（不推残缺数据）
   4) 仅新增未来场次；去重 = 同日+同时+标题归一化互含（库里是简称、接口是全称）
   5) 无新增 = 不改文件不 commit 不 push
   用法：node scrape.js [--dry-run]
   ============================================================ */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const EV = path.join(REPO, 'events.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (a, b) => a + Math.floor(Math.random() * (b - a));

const SITES = [
  { name: '北理工', base: 'https://job.bit.edu.cn',     type: 'bit',  src: 'bit'  },
  { name: '北大',   base: 'https://scc.pku.edu.cn',     type: 'pku',  src: 'pku'  },
  { name: '北航',   base: 'https://career.buaa.edu.cn', type: 'buaa', src: 'buaa' },
  { name: '北师大', base: 'https://career.bnu.edu.cn',  type: 'other', src: 'bnu' },
  { name: '农大',   base: 'https://scc.cau.edu.cn',     type: 'other', src: 'cau'  },
];

const KEYWORDS = [
  /中核|核工业|中广核|国家电投|国家能源集团|华能|大唐|华电|三峡|中节能/,
  /兵器|航天科技|航天科工|航空工业|中国航发|中国电科|电子科技集团/,
  /国家电网|南方电网|中石油|中石化|中海油/,
  /华为|中信集团/,
];

function levelOf(item) {
  const t = item.title || '', ft = item.fairTypeName || '';
  if (/空中|线上|直播/.test(t + ft)) return { lv: 4, key: 0 };
  for (const re of KEYWORDS) if (re.test(t)) return { lv: 2, key: 1 };
  if (/双选会|洽谈会/.test(ft + t)) return { lv: 2, key: 0 };
  return { lv: 3, key: 0 };
}

async function fetchMonth(site, ym, referer) {
  const url = site.base + '/f/recruitmentFair/ajax_calendar_list?time=' + ym;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': referer, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 200) {
        const j = await res.json();
        if (j && j.state === 1 && Array.isArray(j.data)) return j.data;
        throw new Error('state=' + (j && j.state));
      }
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await sleep(8000);
    }
  }
  throw lastErr;
}

function bjNow() { return new Date(Date.now() + 8 * 3600e3); }
function pad2(n) { return String(n).padStart(2, '0'); }

/* 标题归一化：剥掉届别/场次类型后缀（库里是简称、接口是全称） */
const ALIAS = [[/北京理工大学/g, '北理工'], [/北京大学/g, '北大'], [/北京航空航天大学/g, '北航'], [/北京师范大学/g, '北师大']];
function norm(s) {
  let t = (s || '')
    .replace(/\s|【|】|\[|\]|“|”|"|『|』|（[^）]*）|\([^)]*\)/g, '')
    .replace(/20\d{2}(届|年度?|届生)?/g, '')
    .replace(/校园|秋季|春季|全球|联合|空中宣讲会|宣讲会|宣讲|双选会|招聘会|洽谈会|见面会|专场|正式启动|启动会|暨|校招|招聘|年度|有限公司|股份|公司|集团/g, '')
    .replace(/[+＋·—\-_/、，,]+/g, '')
    .toLowerCase();
  for (const [re, to] of ALIAS) t = t.replace(re, to);
  return t;
}
function isDup(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) && y.length >= 3) return true;
  if (y.includes(x) && x.length >= 3) return true;
  if (x.slice(0, 6) === y.slice(0, 6) && Math.min(x.length, y.length) >= 6) return true;
  if (y.length <= 2 && x.startsWith(y)) return true;   // “华为”这类两字短名
  if (x.length <= 2 && y.startsWith(x)) return true;
  return false;
}
function placeDup(a, b) {
  const x = (a || '').replace(/\s/g, ''), y = (b || '').replace(/\s/g, '');
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

const CHEERS = [
  '信息每多一分，运气就多一分。稳住节奏，好事在路上了。',
  '把每一步都踩在自己选的路上，收获会说话。',
  '机会偏爱有清单的人。今天也是离 offer 更近的一天。',
  '慢慢来，比较快。你的准备正在悄悄攒利息。',
  '不下牌桌，就还有一手好牌。继续走。',
];

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const evSrc = fs.readFileSync(EV, 'utf8');

  /* 现有条目索引：mmdd -> [{time,title,place}] */
  const index = new Map();
  const re = /\["(\d{2}-\d{2})","([^"]*)","([^"]*)","([^"]*)"/g;
  let m;
  while ((m = re.exec(evSrc))) {
    if (!index.has(m[1])) index.set(m[1], []);
    index.get(m[1]).push({ time: m[2], title: m[3], place: m[4] });
  }
  function seen(mmdd, time, title, place) {
    const arr = index.get(mmdd);
    if (!arr) return false;
    const nt = norm(title);
    for (const e of arr) {
      const d = isDup(e.title, title);
      if (d) {
        if (e.time === time) return true;
        if (!/^\d{1,2}:\d{2}$/.test(e.time)) return true;
        if (placeDup(e.place, place)) return true;
        continue;
      }
      /* 兜底：标题前3字相同 + 地点互含 → 同一场（如“中国电科五十三所”vs“中国电科第五十三研究所”） */
      if (nt && nt.slice(0, 3) === norm(e.title).slice(0, 3) && placeDup(e.place, place)) return true;
      /* 大型综合场：同日同时同校只有一场，标题双方都含“综合招聘会”即重复 */
      if (/大型综合|综合招聘会/.test(title) && /大型综合|综合招聘会/.test(e.title) && e.time === time) return true;
    }
    return false;
  }
  function remember(mmdd, time, title, place) {
    if (!index.has(mmdd)) index.set(mmdd, []);
    index.get(mmdd).push({ time, title, place });
  }

  const now = bjNow();
  const Y = now.getUTCFullYear(), MO = now.getUTCMonth();
  const today = `${Y}-${pad2(MO + 1)}-${pad2(now.getUTCDate())}`;
  const months = [`${Y}-${pad2(MO + 1)}`, `${Y + (MO === 11 ? 1 : 0)}-${pad2((MO + 1) % 12 + 1)}`];

  const fresh = [];
  const perSite = [];

  for (const site of SITES) {
    const referer = site.base + '/';
    let items = [], ok = true;
    try {
      for (const ym of months) {
        const arr = await fetchMonth(site, ym, referer);
        items = items.concat(arr);
        await sleep(jitter(4000, 9000)); // 反爬：同站请求间隔
      }
    } catch (e) {
      ok = false;
      console.log(`[${site.name}] 抓取失败：${e.message}`);
    }
    let added = 0;
    if (ok) {
      for (const it of items) {
        const date = (it.startTimeFormat || '').trim();
        const time = (it.startTimexs || '').trim();
        const title = (it.title || '').trim().replace(/["\\]/g, '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !title) continue;
        if (/讲座|公开课|大赛|比赛|考试|职业规划|简历门诊|辅导|课程|分享会/.test(title)) continue; // 非招聘活动
        if (date < today) continue;
        const mmdd = date.slice(5);
        if (seen(mmdd, time, title, (it.field || ''))) continue;
        remember(mmdd, time, title, (it.field || ''));
        const { lv, key } = levelOf(it);
        const place = (it.field || '待定').replace(/"/g, '');
        const ft = (it.fairTypeName || '宣讲会').replace(/"/g, '');
        const note = `${ft}（服务器自动抓取）`;
        fresh.push({ mmdd, title, site, line: `["${mmdd}","${time}","${title}","${place}",${lv},"${site.type}","${note}",${key},"${site.src}"]` });
        added++;
      }
    }
    perSite.push({ name: site.name, ok, total: items.length, added });
    await sleep(jitter(4000, 9000)); // 反爬：站间间隔
  }

  console.log('[站点状态]', perSite.map(s => `${s.name}:${s.ok ? '在线' + s.total + '条, 新增' + s.added : '失败'}`).join(' | '));

  if (!fresh.length) { console.log('本轮无新增，不推送'); return; }
  if (perSite.some(s => !s.ok)) {
    console.log('有站点失败，为避免数据残缺，本轮放弃推送');
    process.exit(2);
  }

  /* ---- 版本号：V{M}.{D}.{当日第几次} ---- */
  const verPrefix = `V${MO + 1}.${now.getUTCDate()}.`;
  let n = 0;
  const verRe = /"(V\d+\.\d+\.\d+)"/g;
  let vm;
  while ((vm = verRe.exec(evSrc))) if (vm[1].startsWith(verPrefix)) n = Math.max(n, parseInt(vm[1].split('.')[2], 10));
  const VER = verPrefix + (n + 1);

  /* CHANGELOG：按校汇总，不逐条罗列 */
  const summary = perSite.filter(s => s.added > 0).map(s => `补 <b>${s.name} ${s.added} 场</b>`);
  const changelog = `  "${VER}": {
    title: "本次更新：服务器自动抓取补 ${fresh.length} 场",
    items: [
      "${summary.join('、')}（时间地点详见日历，来源已标注）",
      "本条及以后场次由云服务器每 3 小时自动抓取各校就业网接口同步，无人工干预"
    ],
    cheer: "${CHEERS[Math.floor(Math.random() * CHEERS.length)]}"
  },
`;

  const byDay = {};
  fresh.forEach(f => { (byDay[f.mmdd] = byDay[f.mmdd] || []).push(f.line); });
  const dayComment = mm => {
    const mon = parseInt(mm.slice(0, 2), 10), d = parseInt(mm.slice(3), 10);
    const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(Y, mon - 1, d).getDay()];
    return `// ============ ${pad2(mon)}/${pad2(d)} 周${wd}（自动抓取） ============`;
  };
  const insertBlock = (src, dayMap) => {
    const blocks = Object.keys(dayMap).sort().map(mm => dayComment(mm) + '\n' + dayMap[mm].join(',\n')).join('\n');
    return src
      .replace(/,\s*\n\];/, '\n];')                      // 规范化：去掉可能已存在的数组尾逗号
      .replace('var CHANGELOG = {\n', 'var CHANGELOG = {\n' + changelog)
      .replace(/var DATA_VERSION = "[^"]+";/, `var DATA_VERSION = "${VER}";`)
      .replace(/\n\];\s*$/, ',\n' + blocks + '\n];\n');  // 上一元素补逗号 + 新块（每行自带逗号）
  };

  if (dryRun) {
    console.log('[DRY-RUN] 将新增', fresh.length, '场, 版本', VER);
    console.log(fresh.slice(0, 10).map(f => f.mmdd + ' ' + f.title).join('\n'));
    return;
  }

  const { execSync } = require('child_process');
  const git = (cmd) => execSync(cmd, { cwd: REPO, stdio: 'pipe' }).toString().trim();

  /* 先同步远端，降低与本机 AI 任务冲突概率；pull 后重放去重 */
  let latest = evSrc;
  try {
    git('git pull --rebase --autostash origin main');
    latest = fs.readFileSync(EV, 'utf8');
  } catch (e) {
    console.log('git pull 失败，本轮放弃：', e.message);
    process.exit(2);
  }

  if (latest !== evSrc) {
    /* 用远端最新文件重建索引，复用同一套去重逻辑 */
    index.clear();
    let m2;
    const re2 = /\["(\d{2}-\d{2})","([^"]*)","([^"]*)","([^"]*)"/g;
    while ((m2 = re2.exec(latest))) {
      if (!index.has(m2[1])) index.set(m2[1], []);
      index.get(m2[1]).push({ time: m2[2], title: m2[3], place: m2[4] });
    }
    const still = fresh.filter(f => {
      const raw = f.line.match(/^\["(\d{2}-\d{2})","([^"]*)","([^"]*)","([^"]*)"/); // 行以[开头，^后必须有\[（WorkBuddy 诊断的真正根因）
      return raw && !seen(raw[1], raw[2], raw[3], raw[4]); // raw=null（行格式异常）时跳过而非崩溃
    });
    if (!still.length) { console.log('pull 后发现新增均已被他端收录，不推送'); return; }
    const byDay2 = {};
    still.forEach(f => { (byDay2[f.mmdd] = byDay2[f.mmdd] || []).push(f.line); });
    fs.writeFileSync(EV, insertBlock(latest, byDay2));
    console.log(`pull 后实际新增 ${still.length} 场`);
  } else {
    fs.writeFileSync(EV, insertBlock(latest, byDay));
  }

  try {
    git('git add events.js');
    git(`git commit -m "data: ${VER} 服务器自动抓取（5校接口增量）"`);
    git('git push origin main');
    console.log(`OK ${VER} 已推送：新增 ${fresh.length} 场`);
  } catch (e) {
    /* push 冲突时：rebase 后直接重推（commit 在首次已生成） */
    try {
      git('git pull --rebase --autostash origin main');
      git('git push origin main');
      console.log(`OK ${VER} 重试后已推送：新增 ${fresh.length} 场`);
    } catch (e2) {
      console.log('git 推送失败（重试后）：', e2.message);
      process.exit(2);
    }
  }
})();
