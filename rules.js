/*
 * 2026年 年収の壁チェッカー — 判定ロジック（rules.js）
 *
 * - 対象: 2026年（令和8年）分の給与収入だけがある人
 * - 基準日: 2026年10月25日時点で確認できた公表資料（各定数の出典コメント参照）
 * - このファイルは画面（app.js）とテスト（test/rules.test.mjs）の両方から使う。
 *   ブラウザでは <script src="rules.js"> で読み込み、globalThis.NenshuRules に公開する。
 *   Node では CommonJS（module.exports）として読み込む。
 * - 外部への送信・保存は一切しない（純粋な計算関数のみ）。
 * - 確認できない条件は判定せず status: "unknown"（要確認）を返す。
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 出典URL（2026-09-26 に取得して本文を確認。2026-10-25 に再確認）
  // ---------------------------------------------------------------------------
  var SRC = {
    // 国税庁「令和８年度税制改正による所得税の基礎控除の引上げ等について」
    NTA_KISO: 'https://www.nta.go.jp/users/gensen/2026kiso/index.htm',
    // 国税庁「令和８年４月 源泉所得税の改正のあらまし」p.1〜2（基礎控除・給与所得控除・所得要件・控除額表）
    NTA_PAMPH: 'https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf',
    // 国税庁「令和８年度税制改正（所得税の基礎控除の引上げ等関係）Ｑ＆Ａ（令和８年５月）」
    NTA_QA: 'https://www.nta.go.jp/users/gensen/2026kiso/pdf/0026005-024.pdf',
    // 国税庁 タックスアンサー（いずれも [令和8年4月1日現在法令等]）
    TA_1410: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm', // 給与所得控除
    TA_1199: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm', // 基礎控除
    TA_1180: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1180.htm', // 扶養控除
    TA_1177: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1177.htm', // 特定親族特別控除
    TA_1191: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1191.htm', // 配偶者控除
    TA_1195: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1195.htm', // 配偶者特別控除
    // e-Gov 法令検索（成立した法令の条文）
    EGOV_CHIHOZEI: 'https://laws.e-gov.go.jp/law/325AC0000000226', // 地方税法（第295条 人的非課税、第313条第2項、附則第3条の3 所得割の非課税限度額）
    EGOV_KENPO: 'https://laws.e-gov.go.jp/law/211AC0000000070',    // 健康保険法（第3条第7項ただし書 後期高齢者医療の被保険者は被扶養者にならない）
    EGOV_KOSEINENKIN: 'https://laws.e-gov.go.jp/law/329AC0000000115', // 厚生年金保険法（第9条 70歳未満、第12条 適用除外、附則第4条の6）
    // 総務省（個人住民税）
    SOUMU_KENTO: 'https://www.soumu.go.jp/main_content/001075462.pdf', // 個人住民税の基礎控除等について（令和8年5月29日 資料３、法律の成立後）p.9〜10
    // 日本年金機構
    NENKIN_TANJIKAN: 'https://www.nenkin.go.jp/service/kounen/tekiyo/jigyosho/tanjikan.html', // 短時間労働者の適用拡大
    NENKIN_TEKIYO: 'https://www.nenkin.go.jp/service/kounen/tekiyo/jigyosho/20150518.html',   // 適用事業所と被保険者（4分の3基準）
    NENKIN_HIFUYO: 'https://www.nenkin.go.jp/service/kounen/tekiyo/hihokensha1/20141202.html', // 被扶養者の認定（130万円・180万円）
    NENKIN_19_22: 'https://www.nenkin.go.jp/oshirase/taisetu/2025/202508/0819.html',        // 19歳以上23歳未満は150万円未満
    NENKIN_KEIYAKU: 'https://www.nenkin.go.jp/oshirase/taisetu/jigyosho/2026/202605/0501.html' // 労働契約内容による年間収入の判定（令和8年4月〜）
  };

  // ---------------------------------------------------------------------------
  // 定数
  // ---------------------------------------------------------------------------

  // 対象年分・基準日
  var TAX_YEAR = 2026; // 令和8年分
  var AS_OF = '2026-10-25';

  // 給与所得控除の最低保障額（令和8・9年分）74万円
  // src: NTA_PAMPH p.1「⑵ 給与所得控除の最低保障額の引上げ」, TA_1410
  var SALARY_DEDUCTION_MIN = 740000;

  // 令和8・9年分の給与収入 69万1,000円以上220万円未満の給与所得の金額（特例）
  // src: NTA_PAMPH p.1 ⑵ハ の表, NTA_QA Q3-1 ①, TA_1410（注2）
  //   69万1,000円以上 74万1,000円未満 → なし（0円）
  //   74万1,000円以上 219万1,000円未満 → 収入金額 − 74万円
  //   219万1,000円以上 219万3,000円未満 → 145万1,000円
  //   219万3,000円以上 219万6,000円未満 → 145万3,000円
  //   219万6,000円以上 220万円未満     → 145万6,000円
  var SALARY_LINEAR_FROM = 741000;
  var SALARY_LINEAR_UNTIL = 2191000; // 未満
  var SALARY_FIXED_STEPS = [
    { from: 2191000, until: 2193000, income: 1451000 },
    { from: 2193000, until: 2196000, income: 1453000 },
    { from: 2196000, until: 2200000, income: 1456000 }
  ];
  // 220万円以上は所得税法別表第五（年末調整等のための給与所得控除後の給与等の金額の表）で求めるため、
  // 本ツールでは計算しない（すべての壁が220万円未満にあるため、判定には影響しない）。
  var SALARY_CALC_LIMIT = 2200000;

  // 基礎控除（令和8年分、合計所得金額132万円以下）104万円（= 62万円 + 加算42万円）
  // src: NTA_PAMPH p.1「⑴ 基礎控除の引上げ」, TA_1199
  // 注意: 加算42万円は令和8・9年分の額（令和10年分以後は加算37万円＝基礎控除99万円）。
  //       給与所得控除の最低保障額74万円のうち5万円も令和8・9年分だけの特例（措法29条の4）。
  //       → 178万円は2026・2027年分の金額。令和10年分以後は 69万＋99万＝168万円になる見込み（NTA_PAMPH p.1 注1・注2）。
  var BASIC_DEDUCTION = 1040000;
  var BASIC_DEDUCTION_TIER_MAX_INCOME = 1320000; // 合計所得金額132万円以下の区分

  // 扶養親族・同一生計配偶者の所得要件 合計所得金額62万円以下（給与のみなら136万円以下）
  // src: NTA_PAMPH p.2「⑶ 扶養親族等の所得要件の改正」, TA_1180, TA_1191
  var DEPENDENT_INCOME_MAX = 620000;

  // 特定親族（19歳以上23歳未満）の所得要件 62万円超123万円以下（給与のみ 136万円超197万円以下）
  // 特定親族特別控除の額（合計所得金額の区分ごと、上限は「以下」）
  // src: NTA_PAMPH p.2（参考）の表, TA_1177
  var TOKUTEI_SHINZOKU_TABLE = [
    { maxIncome: 850000, amount: 630000 },
    { maxIncome: 900000, amount: 610000 },
    { maxIncome: 950000, amount: 510000 },
    { maxIncome: 1000000, amount: 410000 },
    { maxIncome: 1050000, amount: 310000 },
    { maxIncome: 1100000, amount: 210000 },
    { maxIncome: 1150000, amount: 110000 },
    { maxIncome: 1200000, amount: 60000 },
    { maxIncome: 1230000, amount: 30000 }
  ];

  // 扶養控除の額
  // src: TA_1180（一般38万円、特定扶養親族63万円、老人扶養親族48万円／同居老親等58万円）
  //   控除対象扶養親族 = 12月31日現在16歳以上、特定扶養親族 = 19歳以上23歳未満、老人扶養親族 = 70歳以上
  var FUYO_GENERAL = 380000;
  var FUYO_TOKUTEI = 630000;
  var FUYO_ROJIN = 480000;
  var FUYO_ROJIN_DOKYO = 580000;

  // 配偶者控除の額（納税者本人の合計所得金額 900万円以下／950万円以下／1,000万円以下）
  // src: TA_1191
  var HAIGUSHA_KOJO = { general: [380000, 260000, 130000], elderly: [480000, 320000, 160000] };

  // 配偶者特別控除の額（配偶者の合計所得金額 62万円超133万円以下、上限は「以下」）
  // 列は納税者本人の合計所得金額 900万円以下／950万円以下／1,000万円以下
  // src: TA_1195「令和8年分以降」の表, NTA_PAMPH p.2（参考）の表
  var HAIGUSHA_TOKUBETSU_TABLE = [
    { maxIncome: 950000, amounts: [380000, 260000, 130000] },
    { maxIncome: 1000000, amounts: [360000, 240000, 120000] },
    { maxIncome: 1050000, amounts: [310000, 210000, 110000] },
    { maxIncome: 1100000, amounts: [260000, 180000, 90000] },
    { maxIncome: 1150000, amounts: [210000, 140000, 70000] },
    { maxIncome: 1200000, amounts: [160000, 110000, 60000] },
    { maxIncome: 1250000, amounts: [110000, 80000, 40000] },
    { maxIncome: 1300000, amounts: [60000, 40000, 20000] },
    { maxIncome: 1330000, amounts: [30000, 20000, 10000] }
  ];

  // 扶養する人（納税者本人）の収入区分 → 上の表の列。給与のみの場合の収入金額の目安。
  // src: NTA_PAMPH p.2（参考）の表の見出し「900万円以下(1,095万円以下)」「950万円以下(1,145万円以下)」「1,000万円以下(1,195万円以下)」
  var SUPPORTER_BRACKETS = {
    s1: { column: 0, label: '給与収入 1,095万円以下' },
    s2: { column: 1, label: '給与収入 1,095万円超 1,145万円以下' },
    s3: { column: 2, label: '給与収入 1,145万円超 1,195万円以下' },
    s4: { column: null, label: '給与収入 1,195万円超（配偶者控除・配偶者特別控除なし）' }
  };

  // 個人住民税（2026年の収入 → 令和9年度分の住民税。賦課期日は2027年1月1日）
  // 給与所得: 地方税法第313条第2項により所得税の計算の例による → 所得税と同じ「収入−74万円」
  // src: EGOV_CHIHOZEI 第313条第2項, SOUMU_KENTO p.9〜10
  var RESIDENT_SALARY_DEDUCTION_MIN = 740000;
  // 所得割の非課税限度額（単身者）: 35万円 × 1 + 10万円 = 45万円（全国一律）
  // → 給与収入の非課税ライン（単身）119万円
  // src: EGOV_CHIHOZEI 附則第3条の3第1項・第4項（令和9年1月1日施行版でも変更なし）,
  //      SOUMU_KENTO p.9〜10「R8改正後 119万円」「令和9年度分 単身 119」
  var RESIDENT_SHOTOKUWARI_NONTAX_BASE_SINGLE = 450000;
  // 人的非課税（未成年者・障害者・寡婦・ひとり親）: 前年の合計所得金額135万円以下なら均等割・所得割とも非課税
  // 未成年者 = 賦課期日（2027年1月1日）に18歳未満
  // → 給与収入 135万＋74万＝209万円以下
  // src: EGOV_CHIHOZEI 第295条第1項第2号（令和9年1月1日施行版でも「百三十五万円」）
  var RESIDENT_PERSONAL_NONTAX_INCOME_MAX = 1350000;
  // 均等割の非課税限度額は市区町村の条例で定める（級地により異なる）→ 本ツールでは判定しない
  // src: SOUMU_KENTO p.9「均等割 … 各市区町村で異なる（条例で規定）」

  // 社会保険（健康保険・厚生年金保険）
  // 75歳以上は後期高齢者医療の被保険者 → 健康保険の被保険者にも被扶養者にもならない（収入によらない）
  // src: EGOV_KENPO 第3条第1項第1号・第7項ただし書, NENKIN_HIFUYO（削除の事由「後期高齢者医療制度の被保険者になったとき」）
  // 厚生年金の被保険者は70歳未満
  // src: EGOV_KOSEINENKIN 第9条
  // 被扶養者の年間収入要件（「未満」）
  // src: NENKIN_HIFUYO「年間収入130万円未満（60歳以上または障害者の場合は、年間収入180万円未満）」
  var SI_DEPENDENT_LIMIT = 1300000;
  var SI_DEPENDENT_LIMIT_60 = 1800000;
  // 19歳以上23歳未満（被保険者の配偶者を除く）は150万円未満（扶養認定日が令和7年10月1日以降）。
  // 年齢は扶養認定日が属する年の12月31日時点で判定。
  // src: NENKIN_19_22
  var SI_DEPENDENT_LIMIT_19_22 = 1500000;
  // 短時間労働者の加入要件: 週の所定労働時間20時間以上・学生でない・特定適用事業所（被保険者51人以上）等
  // 所定内賃金 月額8.8万円以上の要件（いわゆる106万円の壁）は令和8年10月1日に撤廃
  //   （2026-10-01施行版の厚年法第12条第5号・健保法第3条第1項第9号から削除済み。施行日確定）
  //   例外: 最低賃金の減額特例の対象で月額8.8万円未満の人は原則加入しない（申出で任意加入可）
  //   （厚年法附則第4条の6、健保法附則第8条の3の2）
  // src: EGOV_KOSEINENKIN, EGOV_KENPO, NENKIN_TANJIKAN
  var SI_SHORT_WEEKLY_HOURS = 20;
  var SI_COMPANY_SIZE = 51; // 令和9年10月から36人以上（NENKIN_TANJIKAN「企業規模要件」）
  var SI_WAGE_MONTHLY_OLD = 88000; // 撤廃された賃金要件（表示用）
  var SI_WAGE_REQUIREMENT_ABOLISHED = '2026-10-01'; // 令和8年10月1日に撤廃（施行日確定）

  // ---------------------------------------------------------------------------
  // 入力値のラベル
  // ---------------------------------------------------------------------------
  var POSITIONS = {
    student: '学生で、親などの扶養に入っている・入りたい',
    parent: '学生ではなく、親などの扶養に入っている・入りたい',
    spouse: '配偶者の扶養に入っている・入りたい',
    other: 'その他（扶養に入っていない・入る予定がない）'
  };
  // 年齢はすべて2026年12月31日時点。
  // 16〜17歳と18歳を分けるのは住民税の未成年者の非課税（2027年1月1日に18歳未満）のため、
  // 70〜74歳と75歳以上を分けるのは後期高齢者医療（75歳以上は健康保険の扶養に入れない）のため。
  var AGE_GROUPS = {
    u16: '15歳以下',
    a16_17: '16〜17歳',
    a18: '18歳',
    a19_22: '19〜22歳',
    a23_59: '23〜59歳',
    a60_69: '60〜69歳',
    a70_74: '70〜74歳',
    a75p: '75歳以上'
  };
  function isMinorAtLevyDate(age) { return age === 'u16' || age === 'a16_17'; }
  function isElderly70(age) { return age === 'a70_74' || age === 'a75p'; }

  // ---------------------------------------------------------------------------
  // 計算関数
  // ---------------------------------------------------------------------------

  /** "150万" "1,500,000円" "１５０００００" などを円の整数に。解釈できなければ null。 */
  function parseYen(text) {
    if (text === null || text === undefined) return null;
    var s = String(text)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．]/g, '.')
      .replace(/[,，、\s円]/g, '');
    if (s === '') return null;
    var man = false;
    if (/万$/.test(s)) { man = true; s = s.slice(0, -1); }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    if (man) n = Math.round(n * 10000);
    if (!Number.isFinite(n) || n !== Math.floor(n)) return null;
    if (n < 0 || n > 99999999) return null;
    return n;
  }

  /** 令和8年分の給与所得の金額（給与収入のみ）。220万円以上は null（本ツールの計算範囲外）。 */
  function salaryIncome(revenue) {
    if (revenue < SALARY_LINEAR_FROM) return 0;
    if (revenue < SALARY_LINEAR_UNTIL) return revenue - SALARY_DEDUCTION_MIN;
    for (var i = 0; i < SALARY_FIXED_STEPS.length; i++) {
      var st = SALARY_FIXED_STEPS[i];
      if (revenue >= st.from && revenue < st.until) return st.income;
    }
    return null; // >= 2,200,000
  }

  /** 合計所得金額の上限（以下）に対応する給与収入の上限（以下）。直線区間（所得 1円〜145万円）で有効。 */
  function revenueMaxForIncome(incomeMax) {
    return incomeMax + SALARY_DEDUCTION_MIN;
  }

  function remaining(maxAllowed, revenue) {
    return maxAllowed - revenue;
  }

  // --- 所得税（本人） ---
  // 課税される所得が生じない上限: 給与所得 ≤ 基礎控除104万円 ⇔ 給与収入 ≤ 178万円
  var INCOME_TAX_WALL = revenueMaxForIncome(BASIC_DEDUCTION); // 1,780,000

  /**
   * 年末調整の年税額の目安（給与のみ・所得控除は基礎控除だけ・220万円未満）。
   * 課税所得は1,000円未満切り捨て、税率5%、復興特別所得税を含めて102.1%、100円未満切り捨て。
   * src: TA_1199, NTA_PAMPH（課税総所得金額が195万円以下の税率5%）。220万円以上は null。
   */
  function annualIncomeTax(revenue) {
    var inc = salaryIncome(revenue);
    if (inc === null) return null;
    var taxable = Math.floor(Math.max(0, inc - BASIC_DEDUCTION) / 1000) * 1000;
    var tax = taxable * 5 / 100;            // taxable は1,000円単位なので整数
    return Math.floor(tax * 1021 / 1000 / 100) * 100;
  }
  // 年税額が初めて生じる給与収入（1,782,000円）。178万円を少し超えても、切り捨てで税額は0円のまま。
  var INCOME_TAX_FIRST_TAXED_REVENUE = (function () {
    var r = INCOME_TAX_WALL;
    while (annualIncomeTax(r) === 0) r += 1000; // 課税所得は1,000円単位で変わるため1,000円刻みで十分
    while (annualIncomeTax(r - 1) > 0) r -= 1;
    return r;
  })();
  var INCOME_TAX_ZERO_MAX = INCOME_TAX_FIRST_TAXED_REVENUE - 1; // 1,781,999

  function judgeIncomeTax(revenue) {
    var inc = salaryIncome(revenue);
    var tax = annualIncomeTax(revenue);
    var zeroTax = revenue <= INCOME_TAX_WALL || (tax === 0);
    var roundingZone = zeroTax && revenue > INCOME_TAX_WALL; // 178万円超〜178万1,999円
    var wall = roundingZone ? INCOME_TAX_ZERO_MAX : INCOME_TAX_WALL;
    var summary;
    if (!zeroTax) {
      summary = '178万円を超えています。基礎控除（104万円）を差し引いても課税される所得が残るため、所得税がかかる目安です（ほかの所得控除がない場合、年税額が出始めるのは178万2,000円からです）。';
    } else if (roundingZone) {
      summary = '178万円をわずかに超えていますが、課税所得の1,000円未満切り捨てと年税額の100円未満切り捨てにより、年税額は0円の目安です（ほかの所得控除がない場合）。';
    } else {
      summary = '178万円以下です。ほかに所得がなければ、給与所得（収入−74万円）が基礎控除104万円以下に収まり、課税される所得が生じないため、所得税はかからない目安です。';
    }
    return {
      key: 'incomeTax',
      title: '所得税（あなた自身）',
      status: zeroTax ? 'under' : 'over',
      wall: wall,
      remaining: zeroTax ? remaining(wall, revenue) : 0,
      nextLabel: roundingZone ? '178万2,000円から年税額が生じます' : undefined,
      salaryIncome: inc,
      annualTax: tax,
      summary: summary,
      notes: [
        '178万円 ＝ 給与所得控除の最低保障額74万円 ＋ 基礎控除104万円（2026年分・合計所得金額132万円以下の場合）。178万円を超えると課税される所得が生じ始めます。',
        '178万円は2026年・2027年分の金額です。74万円のうち5万円と、基礎控除の加算42万円の額は2年間だけの措置で、2028年分以後は168万円（69万円＋99万円）になる見込みです。',
        '課税所得は1,000円未満切り捨て、年末調整の年税額（復興特別所得税を含む）は100円未満切り捨てのため、実際に年税額が出始めるのは178万2,000円（年税額100円）からです。社会保険料控除などほかの所得控除があれば、さらに高くなります。',
        '2026年11月までの給与の源泉徴収は改正前の基準で行われます。給与明細で所得税が引かれていても、12月の年末調整（年末調整を受けない場合は確定申告）で精算され、戻る目安です。',
        '給与以外の所得がある場合や、還付される金額の計算は、このツールでは扱いません。'
      ],
      sources: [SRC.NTA_PAMPH, SRC.TA_1410, SRC.TA_1199, SRC.NTA_KISO]
    };
  }

  // --- 住民税（本人） ---
  var RESIDENT_SHOTOKUWARI_WALL = RESIDENT_SHOTOKUWARI_NONTAX_BASE_SINGLE + RESIDENT_SALARY_DEDUCTION_MIN; // 1,190,000
  var RESIDENT_PERSONAL_NONTAX_WALL = RESIDENT_PERSONAL_NONTAX_INCOME_MAX + RESIDENT_SALARY_DEDUCTION_MIN; // 2,090,000

  function judgeResidentTax(revenue, input) {
    var age = input && input.ageGroup;
    var minor = isMinorAtLevyDate(age);
    var notes = [
      '2026年の収入に対する住民税は、2027年度（令和9年度）分として課税されます（賦課期日は2027年1月1日）。',
      '所得割: 給与収入が119万円以下（単身の場合）なら非課税。この基準は全国共通です（地方税法 附則第3条の3。2027年度分の非課税ライン）。',
      '均等割: 非課税になる基準は市区町村の条例で決まり、自治体によって119万円より低いことがあります。お住まいの市区町村で確認してください（このツールでは判定しません）。',
      'あなた自身に扶養している家族がいる場合は、非課税の基準が高くなります（このツールは単身の基準で表示しています）。',
      '住民税の非課税限度額・基礎控除の見直しは、総務省で検討が続いています（2026年度の税制改正大綱）。2027年度分の金額が変わった場合は反映します。'
    ];
    if (minor) {
      notes.unshift(
        '未成年者（2027年1月1日時点で18歳未満）は、2026年の合計所得金額が135万円以下（給与収入だけなら209万円以下）なら、住民税（均等割・所得割とも）がかかりません（地方税法 第295条第1項第2号）。',
        '2026年12月31日時点で17歳でも、1月2日生まれの方は2027年1月1日に18歳になるため、この非課税の対象外です（単身の119万円の基準になります）。'
      );
    } else if (age === 'a18') {
      notes.unshift('18歳の方は、2027年1月1日時点で未成年者（18歳未満）に当たらないため、未成年者の非課税（209万円以下）は使えません。単身の119万円の基準で判定しています。');
    }
    notes.push('障害者・寡婦・ひとり親に当たる方も、合計所得金額135万円以下（給与収入209万円以下）なら住民税がかかりません（このツールでは判定しません。市区町村で確認してください）。');

    if (minor) {
      var overM = revenue > RESIDENT_PERSONAL_NONTAX_WALL;
      return {
        key: 'residentTax',
        title: '住民税（あなた自身・目安）',
        status: overM ? 'over' : 'under',
        minorExempt: !overM,
        wall: RESIDENT_PERSONAL_NONTAX_WALL,
        remaining: overM ? 0 : remaining(RESIDENT_PERSONAL_NONTAX_WALL, revenue),
        nextLabel: overM ? undefined : '209万円（未成年者の非課税の上限）を超えると住民税がかかります',
        summary: overM
          ? '209万円を超えているため、未成年者の非課税には当たりません。住民税（所得割・均等割）がかかる目安です。'
          : '2027年1月1日時点で未成年者（18歳未満）なので、給与収入209万円以下なら住民税（均等割・所得割とも）はかからない目安です。',
        notes: notes,
        sources: [SRC.EGOV_CHIHOZEI, SRC.SOUMU_KENTO]
      };
    }

    var over = revenue > RESIDENT_SHOTOKUWARI_WALL;
    return {
      key: 'residentTax',
      title: '住民税（あなた自身・目安）',
      status: over ? 'over' : 'under',
      wall: RESIDENT_SHOTOKUWARI_WALL,
      remaining: over ? 0 : remaining(RESIDENT_SHOTOKUWARI_WALL, revenue),
      summary: over
        ? '119万円を超えています。住民税（所得割）がかかる目安です（119万円を超えた直後は、所得割は超えた額以下にとどまります）。均等割は市区町村の基準で決まります。'
        : '119万円以下です。住民税の所得割はかからない目安です。均等割は市区町村の基準によってはかかることがあります。',
      notes: notes,
      sources: [SRC.EGOV_CHIHOZEI, SRC.SOUMU_KENTO]
    };
  }

  // --- 扶養する側の控除 ---
  function lookupStep(table, income) {
    for (var i = 0; i < table.length; i++) {
      if (income <= table[i].maxIncome) return { index: i, row: table[i] };
    }
    return null;
  }

  function judgeSupporterDeduction(revenue, input) {
    var pos = input.position;
    var age = input.ageGroup;
    var base = {
      key: 'supporterDeduction',
      title: '扶養する人の税金の控除',
      sources: []
    };
    if (pos === 'other') {
      return Object.assign(base, {
        status: 'na',
        summary: '「その他」を選んだため、扶養する人の控除は判定していません。',
        notes: [],
        remaining: null
      });
    }
    var inc = salaryIncome(revenue);
    var incomeKnown = inc !== null; // 220万円以上は null（すべての控除の上限を超えている）

    if (pos === 'spouse') {
      base.title = '配偶者の税金の控除（配偶者控除・配偶者特別控除）';
      base.sources = [SRC.TA_1191, SRC.TA_1195, SRC.NTA_PAMPH];
      var br = SUPPORTER_BRACKETS[input.supporterBracket];
      var notesS = [
        '136万円以下: 配偶者控除、136万円超207万円以下: 配偶者特別控除（2026年分）。',
        '配偶者の収入が136万円を超えても169万円以下なら、控除額は38万円のまま変わりません（扶養する人の給与収入が1,095万円以下の場合）。',
        'このほか「生計を一にしている」「法律上の配偶者である」などの条件があります。'
      ];
      if (!br) {
        var upcoming = spouseWalls().filter(function (w) { return revenue <= w.at; })[0];
        return Object.assign(base, {
          status: 'unknown',
          summary: '扶養する人（配偶者）の収入が「わからない」ため、控除額は判定していません（要確認）。扶養する人の給与収入が1,195万円を超えると、配偶者控除・配偶者特別控除は受けられません。',
          nextLabel: upcoming ? upcoming.label : null,
          notes: notesS,
          walls: spouseWalls(),
          wall: upcoming ? upcoming.at : undefined,
          remaining: upcoming ? remaining(upcoming.at, revenue) : null
        });
      }
      if (br.column === null) {
        return Object.assign(base, {
          status: 'na',
          summary: '扶養する人の給与収入が1,195万円（合計所得金額1,000万円）を超えるため、配偶者控除・配偶者特別控除は受けられません。',
          notes: notesS,
          remaining: null
        });
      }
      var col = br.column;
      if (incomeKnown && inc <= DEPENDENT_INCOME_MAX) {
        var elderly = isElderly70(age);
        var amt = (elderly ? HAIGUSHA_KOJO.elderly : HAIGUSHA_KOJO.general)[col];
        var nextChange = revenueMaxForIncome(DEPENDENT_INCOME_MAX); // 136万円: 配偶者控除→配偶者特別控除
        return Object.assign(base, {
          status: 'under',
          deductionName: elderly ? '配偶者控除（老人控除対象配偶者）' : '配偶者控除',
          amount: amt,
          wall: nextChange,
          remaining: remaining(nextChange, revenue),
          summary: '136万円以下なので、扶養する人は配偶者控除（' + man(amt) + '）の対象になる目安です。',
          nextLabel: '136万円を超えると配偶者特別控除に切り替わります',
          notes: notesS,
          walls: spouseWalls()
        });
      }
      var hit = incomeKnown ? lookupStep(HAIGUSHA_TOKUBETSU_TABLE, inc) : null;
      if (!hit) {
        return Object.assign(base, {
          status: 'over',
          amount: 0,
          wall: revenueMaxForIncome(HAIGUSHA_TOKUBETSU_TABLE[HAIGUSHA_TOKUBETSU_TABLE.length - 1].maxIncome),
          remaining: 0,
          summary: '207万円を超えているため、配偶者特別控除は受けられない目安です。',
          notes: notesS,
          walls: spouseWalls()
        });
      }
      var amtS = hit.row.amounts[col];
      var changeAt = nextChangeRevenue(HAIGUSHA_TOKUBETSU_TABLE, hit.index, function (r) { return r.amounts[col]; });
      return Object.assign(base, {
        status: 'partial',
        deductionName: '配偶者特別控除',
        amount: amtS,
        wall: changeAt.revenue,
        remaining: remaining(changeAt.revenue, revenue),
        summary: '136万円を超えているため配偶者控除ではなく、配偶者特別控除（' + man(amtS) + '）の対象になる目安です。',
        nextLabel: changeAt.last
          ? '207万円を超えると配偶者特別控除はなくなります'
          : man0(changeAt.revenue) + 'を超えると控除額が減ります',
        notes: notesS,
        walls: spouseWalls()
      });
    }

    // 親などの扶養（student / parent）
    base.title = '親など扶養する人の税金の控除（扶養控除・特定親族特別控除）';
    base.sources = [SRC.TA_1180, SRC.TA_1177, SRC.NTA_PAMPH];
    var notesP = [
      '年齢はその年の12月31日時点で判定します（2026年12月31日）。',
      '扶養控除・特定親族特別控除は「生計を一にしている」ことなどが条件です。'
    ];
    if (!AGE_GROUPS[age]) {
      return Object.assign(base, {
        status: 'unknown',
        summary: '年齢区分が選ばれていないため判定していません。',
        notes: notesP,
        remaining: null
      });
    }
    var depMax = revenueMaxForIncome(DEPENDENT_INCOME_MAX); // 136万円
    var isDependent = incomeKnown && inc <= DEPENDENT_INCOME_MAX;

    if (age === 'u16') {
      return Object.assign(base, {
        status: 'na',
        wall: depMax,
        remaining: isDependent ? remaining(depMax, revenue) : 0,
        summary: '15歳以下（2026年12月31日時点で16歳未満）は、所得税の扶養控除の対象外です（年齢の条件）。' +
          (isDependent ? '収入136万円以下なので「扶養親族」には当たる目安です。' : '収入が136万円を超えているため「扶養親族」にも当たらない目安です。'),
        notes: notesP.concat(['16歳未満の扶養親族は、所得税の控除はありませんが、住民税の非課税の判定などに関係します。']),
        walls: [{ at: depMax, label: '扶養親族の所得要件（136万円以下）' }]
      });
    }

    if (age === 'a19_22') {
      notesP.push('136万円以下なら特定扶養控除（63万円）、136万円超197万円以下なら特定親族特別控除（収入に応じて63万円〜3万円）。136万円を超えたら、扶養する人が「特定親族特別控除申告書」を出す必要があります。');
      if (isDependent) {
        return Object.assign(base, {
          status: 'under',
          deductionName: '特定扶養控除',
          amount: FUYO_TOKUTEI,
          wall: depMax,
          remaining: remaining(depMax, revenue),
          summary: '136万円以下なので、扶養する人は特定扶養控除（63万円）の対象になる目安です。',
          nextLabel: '136万円を超えると特定親族特別控除に切り替わります（159万円までは控除額63万円のまま）',
          notes: notesP,
          walls: tokuteiWalls()
        });
      }
      var hitT = incomeKnown ? lookupStep(TOKUTEI_SHINZOKU_TABLE, inc) : null;
      if (!hitT) {
        return Object.assign(base, {
          status: 'over',
          amount: 0,
          wall: revenueMaxForIncome(TOKUTEI_SHINZOKU_TABLE[TOKUTEI_SHINZOKU_TABLE.length - 1].maxIncome),
          remaining: 0,
          summary: '197万円を超えているため、特定親族特別控除は受けられない目安です。',
          notes: notesP,
          walls: tokuteiWalls()
        });
      }
      var chT = nextChangeRevenue(TOKUTEI_SHINZOKU_TABLE, hitT.index, function (r) { return r.amount; });
      return Object.assign(base, {
        status: 'partial',
        deductionName: '特定親族特別控除',
        amount: hitT.row.amount,
        wall: chT.revenue,
        remaining: remaining(chT.revenue, revenue),
        summary: '136万円を超えているため特定扶養控除ではなく、特定親族特別控除（' + man(hitT.row.amount) + '）の対象になる目安です。',
        nextLabel: chT.last
          ? '197万円を超えると特定親族特別控除はなくなります'
          : man0(chT.revenue) + 'を超えると控除額が減ります',
        notes: notesP,
        walls: tokuteiWalls()
      });
    }

    // 16〜18歳、23〜69歳、70歳以上: 扶養控除（136万円以下のみ）
    var name, amount;
    if (isElderly70(age)) {
      name = '老人扶養親族の扶養控除';
      amount = FUYO_ROJIN;
      notesP.push('70歳以上の扶養控除は48万円（扶養する人やその配偶者の父母・祖父母などで同居している場合は58万円）。');
    } else {
      name = '扶養控除（一般）';
      amount = FUYO_GENERAL;
    }
    if (age !== 'a19_22') {
      notesP.push('19〜22歳以外は、136万円を超えると扶養控除はなくなります（段階的に減る特別控除はありません）。');
    }
    if (isDependent) {
      return Object.assign(base, {
        status: 'under',
        deductionName: name,
        amount: amount,
        wall: depMax,
        remaining: remaining(depMax, revenue),
        summary: '136万円以下なので、扶養する人は' + name + '（' + man(amount) + (isElderly70(age) ? '〜58万円' : '') + '）の対象になる目安です。',
        nextLabel: '136万円を超えると扶養控除はなくなります',
        notes: notesP,
        walls: [{ at: depMax, label: '扶養控除の所得要件（136万円以下）' }]
      });
    }
    return Object.assign(base, {
      status: 'over',
      amount: 0,
      wall: depMax,
      remaining: 0,
      summary: '136万円を超えているため、扶養する人は扶養控除を受けられない目安です。',
      notes: notesP,
      walls: [{ at: depMax, label: '扶養控除の所得要件（136万円以下）' }]
    });
  }

  /** 表の現在の行から、控除額が次に変わる給与収入（その金額「以下」まで同じ額）を返す。 */
  function nextChangeRevenue(table, index, amountOf) {
    var cur = amountOf(table[index]);
    var i = index;
    while (i + 1 < table.length && amountOf(table[i + 1]) === cur) i++;
    return { revenue: revenueMaxForIncome(table[i].maxIncome), last: i === table.length - 1 };
  }

  function spouseWalls() {
    return [
      { at: revenueMaxForIncome(DEPENDENT_INCOME_MAX), label: '配偶者控除 → 配偶者特別控除（136万円）' },
      { at: revenueMaxForIncome(HAIGUSHA_TOKUBETSU_TABLE[0].maxIncome), label: '配偶者特別控除が減り始める（169万円）' },
      { at: revenueMaxForIncome(HAIGUSHA_TOKUBETSU_TABLE[HAIGUSHA_TOKUBETSU_TABLE.length - 1].maxIncome), label: '配偶者特別控除がなくなる（207万円）' }
    ];
  }

  function tokuteiWalls() {
    return [
      { at: revenueMaxForIncome(DEPENDENT_INCOME_MAX), label: '特定扶養控除 → 特定親族特別控除（136万円）' },
      { at: revenueMaxForIncome(TOKUTEI_SHINZOKU_TABLE[0].maxIncome), label: '特定親族特別控除が減り始める（159万円）' },
      { at: revenueMaxForIncome(TOKUTEI_SHINZOKU_TABLE[TOKUTEI_SHINZOKU_TABLE.length - 1].maxIncome), label: '特定親族特別控除がなくなる（197万円）' }
    ];
  }

  // --- 社会保険 ---
  var LATE_ELDERLY_TEXT = '75歳以上の方は後期高齢者医療制度の被保険者になるため、勤務先の健康保険にも、家族の健康保険の扶養（被扶養者）にも入りません（収入や労働時間によりません）。厚生年金も70歳以上は被保険者になりません。医療保険の保険料は後期高齢者医療制度で納めます。';

  /** 勤務先の健康保険・厚生年金に加入する条件（金額によらない部分）の判定 */
  function judgeOwnEnrollment(input) {
    var hours = input.weeklyHours;
    var size = input.companySize;
    var age = input.ageGroup;
    var isStudent = input.position === 'student';
    if (age === 'a75p') {
      return { status: 'no', lateElderly: true, text: LATE_ELDERLY_TEXT };
    }
    var over70 = age === 'a70_74';
    // 70〜74歳は健康保険だけ（厚生年金は70歳未満。厚年法第9条）
    var insName = over70 ? '勤務先の健康保険' : '勤務先の健康保険・厚生年金';
    var over70Note = over70 ? '（70歳以上の方は厚生年金の被保険者にはならず、健康保険だけが対象です）' : '';
    if (hours === 'full') {
      return { status: 'yes', text: '所定労働時間・日数が正社員の4分の3以上なので、' + insName + 'に加入する条件に当たる目安です（会社の規模や収入によりません）。' + over70Note };
    }
    if (hours === 'lt20') {
      return { status: 'no', text: '週の所定労働時間が20時間未満なので、短時間労働者として勤務先の社会保険に加入する条件には当たらない目安です。' };
    }
    if (hours === 'ge20') {
      if (isStudent) {
        return { status: 'no', text: '学生（昼間の学校に在学中）は、短時間労働者の加入条件の対象外です（休学中・夜間・定時制・卒業後も同じ勤務先で働く予定の方などは例外）。' };
      }
      if (size === 'large' || size === 'public') {
        return { status: 'yes', text: '週20時間以上で、' + (size === 'public' ? '国・地方公共団体の事業所' : '従業員（厚生年金の被保険者）51人以上の勤務先') + 'なので、' + insName + 'に加入する条件に当たる目安です。' + over70Note + '「月額8.8万円以上」の賃金要件は2026年10月1日に撤廃されたため、収入にかかわらず加入対象です（2026年9月までは月額8.8万円以上が条件でした。最低賃金の減額特例の対象で月額8.8万円未満の方は、原則として加入しません）。' };
      }
      if (size === 'small') {
        return { status: 'no', text: '従業員50人以下の勤務先では、週20時間以上でも（正社員の4分の3未満なら）原則として加入対象になりません。ただし労使の合意で加入する事業所（任意特定適用事業所）もあります。2027年10月からは36人以上の企業も対象になります。' };
      }
    }
    return { status: 'unknown', text: '勤務先の規模または週の労働時間が「わからない」ため、勤務先の社会保険に加入する条件は判定していません（要確認）。勤務先に確認してください。' };
  }

  function judgeSocialInsurance(revenue, input) {
    var own = judgeOwnEnrollment(input);
    var age = input.ageGroup;
    // 国民年金（第1号）は20歳以上60歳未満。60歳以上は国民健康保険だけを案内する
    var noPension = age === 'a60_69' || isElderly70(age);
    var selfIns = noPension ? '国民健康保険' : '国民健康保険・国民年金';
    var notes = [
      '「106万円の壁」（所定内賃金 月額8.8万円以上の要件）は、2026年10月1日に撤廃されました（2026年9月までの期間はこの要件がありました）。現在は、週20時間以上などの条件だけで加入するかどうかが決まります。',
      '例外: 最低賃金の減額特例の対象で、月額8.8万円未満の方は、10月以降も原則として加入しません（申し出により加入できます）。',
      '2か月以内の期間を定めて雇われる人などは、加入対象から除かれる場合があります。'
    ];
    var sources = [SRC.NENKIN_TANJIKAN, SRC.NENKIN_TEKIYO, SRC.EGOV_KOSEINENKIN];
    var result = {
      key: 'socialInsurance',
      title: '社会保険（健康保険・年金）',
      own: own,
      notes: notes,
      sources: sources
    };

    if (age === 'a75p') {
      result.status = 'na';
      result.badge = ['扶養の対象外（後期高齢者医療）', 'neutral'];
      result.dependent = null;
      result.remaining = null;
      result.summary = LATE_ELDERLY_TEXT;
      notes.unshift('健康保険法 第3条第7項ただし書により、後期高齢者医療の被保険者は健康保険の被扶養者になりません。65〜74歳で一定の障害があり後期高齢者医療の認定を受けた方も同じです。');
      sources.push(SRC.EGOV_KENPO, SRC.NENKIN_HIFUYO);
      return result;
    }

    if (input.position === 'other') {
      result.status = own.status === 'yes' ? 'over' : own.status === 'unknown' ? 'unknown' : 'na';
      result.dependent = null;
      result.remaining = null;
      result.summary = own.text + '（扶養に入らない場合、勤務先の社会保険に加入しないときは、ご自身で' + selfIns + 'に加入します。）';
      return result;
    }

    // 被扶養者の年間収入要件
    var limit, limitLabel;
    if (age === 'a60_69' || age === 'a70_74') {
      limit = SI_DEPENDENT_LIMIT_60; limitLabel = '180万円未満（60歳以上）';
    } else if (age === 'a19_22' && input.position !== 'spouse') {
      limit = SI_DEPENDENT_LIMIT_19_22; limitLabel = '150万円未満（19〜22歳、配偶者以外）';
    } else {
      limit = SI_DEPENDENT_LIMIT; limitLabel = '130万円未満';
    }
    sources.push(SRC.NENKIN_HIFUYO, SRC.NENKIN_19_22, SRC.NENKIN_KEIYAKU);
    var maxAllowed = limit - 1; // 「未満」
    var underLimit = revenue < limit;
    result.dependent = { limit: limit, limitLabel: limitLabel, underLimit: underLimit };
    result.wall = maxAllowed;
    notes.push(
      '被扶養者の「年間収入」は、1〜12月の合計ではなく、扶養に入る時点からの今後1年間の見込みです（2026年4月からは、給与収入だけの人は労働契約の内容から見込む取り扱いもあります）。',
      '通勤手当（交通費）も年間収入に含みます。このツールは入力した給与収入だけで判定しているため、通勤手当がある方は、その年額を足した金額で判定し直してください。',
      '150万円未満の基準は、19歳以上23歳未満の方（被保険者の配偶者を除く）が対象です。180万円未満の基準は、60歳以上の方または障害者の方が対象です。',
      '同居の場合は、扶養する人の年間収入の半分未満であることも条件です（別居の場合は仕送り額未満）。',
      '健康保険組合によっては、認定の方法が異なることがあります。扶養する人の勤務先（健康保険組合・協会けんぽ）で確認してください。',
      '扶養する人が国民健康保険に加入している場合は、「扶養」という仕組みはありません。'
    );
    if (age === 'a60_69' || age === 'a23_59') {
      notes.push('60歳以上（180万円未満）の基準を何歳の時点で判定するかは、一次情報で確認できていません（このツールは2026年12月31日時点の年齢で判定しています）。60歳の誕生日の前後の方は、扶養する人の勤務先で確認してください。');
    }
    if (age === 'a70_74') {
      notes.push('75歳になると後期高齢者医療制度の被保険者になり、健康保険の扶養から外れます（収入によりません）。');
    }
    if (input.position === 'spouse' && !noPension) {
      notes.push('配偶者（20〜59歳）の場合、健康保険の扶養から外れると、国民年金の第3号被保険者からも外れます。');
    }

    if (own.status === 'yes') {
      result.status = 'over';
      result.remaining = 0;
      result.summary = own.text + ' 勤務先の社会保険に加入すると、収入にかかわらず健康保険の扶養からは外れます。';
      return result;
    }
    if (underLimit) {
      result.status = own.status === 'unknown' ? 'unknown' : 'under';
      result.remaining = remaining(maxAllowed, revenue);
      result.summary = '年間収入の見込みが' + limitLabel + 'の範囲内なので、健康保険の扶養の収入要件を満たす目安です（通勤手当がある方はその分も含めて判断してください）。' +
        (own.status === 'unknown' ? ' ただし、勤務先の社会保険に加入する条件に当たると扶養から外れます（勤務先の条件は要確認）。' : ' ' + own.text);
    } else {
      result.status = 'over';
      result.remaining = 0;
      result.summary = '年間収入の見込みが' + man0(limit) + '以上で、扶養の収入要件（' + limitLabel + '）を満たさないため、健康保険の扶養から外れる目安です。勤務先の社会保険に加入しない場合は、' + selfIns + 'に加入することになります。';
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // まとめ
  // ---------------------------------------------------------------------------
  function validate(input) {
    var errors = [];
    if (typeof input.revenue !== 'number' || !Number.isInteger(input.revenue) || input.revenue < 0 || input.revenue > 99999999) {
      errors.push('revenue');
    }
    if (!POSITIONS[input.position]) errors.push('position');
    if (input.position !== 'other' && !AGE_GROUPS[input.ageGroup]) errors.push('ageGroup');
    return errors;
  }

  function evaluate(input) {
    var errors = validate(input);
    if (errors.length) return { ok: false, errors: errors };
    var r = input.revenue;
    var sections = [
      judgeIncomeTax(r),
      judgeResidentTax(r, input),
      judgeSupporterDeduction(r, input),
      judgeSocialInsurance(r, input)
    ];
    // 次の壁（まだ超えていない金額の壁のうち、いちばん近いもの）
    var candidates = [];
    sections.forEach(function (s) {
      if (s.remaining !== null && s.remaining !== undefined && s.remaining >= 0 && (s.status === 'under' || s.status === 'partial' || s.status === 'na' || s.status === 'unknown') && typeof s.wall === 'number' && r <= s.wall) {
        candidates.push({ key: s.key, title: s.title, wall: s.wall, remaining: s.remaining });
      }
    });
    candidates.sort(function (a, b) { return a.remaining - b.remaining; });
    return {
      ok: true,
      taxYear: TAX_YEAR,
      asOf: AS_OF,
      revenue: r,
      salaryIncome: salaryIncome(r),
      outOfCalcRange: r >= SALARY_CALC_LIMIT,
      sections: sections,
      nextWall: candidates.length ? candidates[0] : null
    };
  }

  function man(yen) { return (yen / 10000) + '万円'; }
  function man0(yen) {
    var m = Math.floor(yen / 10000), rest = yen % 10000;
    return rest ? m + '万' + rest.toLocaleString('ja-JP') + '円' : m + '万円';
  }

  var api = {
    SRC: SRC,
    TAX_YEAR: TAX_YEAR,
    AS_OF: AS_OF,
    POSITIONS: POSITIONS,
    AGE_GROUPS: AGE_GROUPS,
    SUPPORTER_BRACKETS: SUPPORTER_BRACKETS,
    CONST: {
      SALARY_DEDUCTION_MIN: SALARY_DEDUCTION_MIN,
      BASIC_DEDUCTION: BASIC_DEDUCTION,
      BASIC_DEDUCTION_TIER_MAX_INCOME: BASIC_DEDUCTION_TIER_MAX_INCOME,
      INCOME_TAX_WALL: INCOME_TAX_WALL,
      DEPENDENT_INCOME_MAX: DEPENDENT_INCOME_MAX,
      TOKUTEI_SHINZOKU_TABLE: TOKUTEI_SHINZOKU_TABLE,
      HAIGUSHA_KOJO: HAIGUSHA_KOJO,
      HAIGUSHA_TOKUBETSU_TABLE: HAIGUSHA_TOKUBETSU_TABLE,
      FUYO_GENERAL: FUYO_GENERAL,
      FUYO_TOKUTEI: FUYO_TOKUTEI,
      FUYO_ROJIN: FUYO_ROJIN,
      FUYO_ROJIN_DOKYO: FUYO_ROJIN_DOKYO,
      RESIDENT_SHOTOKUWARI_WALL: RESIDENT_SHOTOKUWARI_WALL,
      RESIDENT_PERSONAL_NONTAX_INCOME_MAX: RESIDENT_PERSONAL_NONTAX_INCOME_MAX,
      RESIDENT_PERSONAL_NONTAX_WALL: RESIDENT_PERSONAL_NONTAX_WALL,
      INCOME_TAX_FIRST_TAXED_REVENUE: INCOME_TAX_FIRST_TAXED_REVENUE,
      SI_DEPENDENT_LIMIT: SI_DEPENDENT_LIMIT,
      SI_DEPENDENT_LIMIT_19_22: SI_DEPENDENT_LIMIT_19_22,
      SI_DEPENDENT_LIMIT_60: SI_DEPENDENT_LIMIT_60,
      SI_SHORT_WEEKLY_HOURS: SI_SHORT_WEEKLY_HOURS,
      SI_COMPANY_SIZE: SI_COMPANY_SIZE,
      SI_WAGE_MONTHLY_OLD: SI_WAGE_MONTHLY_OLD,
      SI_WAGE_REQUIREMENT_ABOLISHED: SI_WAGE_REQUIREMENT_ABOLISHED,
      SALARY_CALC_LIMIT: SALARY_CALC_LIMIT
    },
    parseYen: parseYen,
    salaryIncome: salaryIncome,
    revenueMaxForIncome: revenueMaxForIncome,
    annualIncomeTax: annualIncomeTax,
    judgeIncomeTax: judgeIncomeTax,
    judgeResidentTax: judgeResidentTax,
    judgeSupporterDeduction: judgeSupporterDeduction,
    judgeOwnEnrollment: judgeOwnEnrollment,
    judgeSocialInsurance: judgeSocialInsurance,
    evaluate: evaluate,
    formatMan: man0
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.NenshuRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
