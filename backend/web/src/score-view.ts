// 设备安全打分的视图层：把后端 score JSON 归一成「渲染需要什么」。
// 纯函数、无 React、无 DOM，node:test 可以直接 import 这个 .ts 跑断言（不连后端）。
// 契约：GET /api/admin/reports/{id}/device-profile 顶层新增 score（version=sigmark-score/1）。

export type Band = 'A' | 'B' | 'C' | 'D' | '?';

export type Deduction = {
  code: string; label?: string; points?: number; keys?: string[]; detail?: string;
};
export type ScoreAxis = {
  code: string; label?: string; weight?: number; score?: number | null;
  coverage?: number; deductions?: Deduction[];
};
export type ScoreCap = { code: string; band?: string; reason?: string };
export type ScoreUndetermined = { axis: string; keys?: string[]; reason?: string };
export type ScorePayload = {
  version?: string; value?: number | null; band?: string; bandLabel?: string;
  coverage?: number; coverageLabel?: string; decisive?: boolean;
  axes?: ScoreAxis[]; caps?: ScoreCap[]; undetermined?: ScoreUndetermined[];
};

export type DeductionView = { code: string; label: string; pointsText: string; keys: string[]; detail: string };
export type LedgerRow = DeductionView & { axis: string; axisLabel: string };
export type AxisView = {
  code: string; label: string; weight: number; weightText: string;
  score: number | null; scoreText: string | null;
  coverage: number | null; coverageText: string;
  counted: boolean; note: string | null;
  deductions: DeductionView[];
};
export type CapView = { code: string; band: string; bandLabel: string; reason: string };
export type UndeterminedView = { axis: string; axisLabel: string; keys: string[]; reason: string; reasonText: string };
export type ScoreView = {
  scored: boolean; band: Band; bandLabel: string; headline: string; tone: string;
  score: number | null; scoreText: string | null; scoreQualifier: string | null;
  coverageText: string; coverageLabel: string; decisive: boolean;
  axes: AxisView[]; ledger: LedgerRow[];
  caps: CapView[]; hasCaps: boolean; capNotice: string | null; capExplanation: string;
  undetermined: UndeterminedView[]; undeterminedLead: string; undeterminedNote: string;
  warnings: string[]; note: string | null;
  // 版本协商：见 scoreVersion 的注释。未知版本时 band/tone 仍然给出，但 versionWarning
  // 非空，界面必须把它显示出来，且不得用本版的颜色去染色。
  version: string; versionSupported: boolean; versionWarning: string | null;
};

// 五档映射：band 是主产物，label 只是它的中文名。
export const bandLabels: Record<Band, string> = {
  A: '一致', B: '有疑点', C: '可疑', D: '高度可疑', '?': '未知',
};
export const bandTones: Record<Band, string> = {
  A: 'consistent', B: 'doubt', C: 'suspect', D: 'high', '?': 'unknown',
};
export const bandOrder: Band[] = ['A', 'B', 'C', 'D', '?'];

// coverage 低于这个门槛的轴，明确不计入总分，而不是悄悄显示一个漂亮分数。
export const coverageFloor = 0.5;
export const scoreQualifier = '仅用于排序';
export const unscoredHeadline = '数据不足，未给分';
export const unscoredNote = '本次没有读到足够的数据，所以不给分。这不等于 0 分，也不等于满分。';
export const capExplanation = '决定性项不参与三条轴的平均：它单独命中，等级就直接压到 D。九条合格项平均不掉一条致命项——平均只会稀释证据，不会消除证据。';
export const undeterminedLead = '这些通道没读到，所以本次判断不覆盖它们。';

// 版本协商。这是 §8.4 的降级约定，之前只写在文档里，代码不读 version 字段。
//
// 为什么必须读：`sigmark-score/N` 的语义是「判定规则版本」。升到 /2 之后，阈值、
// 权重、决定性清单都可能变。一个还停在 /1 的前端如果照旧拿 A≥85 去染色，会把 /2
// 判成 C 的设备染成 B——**颜色是给人看的结论，染错比不染更糟**。
//
// 降级的做法是「认不出就不下结论」，不是「猜一个」：
//   - 认识的版本 → 正常渲染，versionWarning = null
//   - 不认识的版本 → 数字和 band 照原样透出（那是后端算的，不该被前端改写），
//     但 tone 强制为 'unknown'（不上色），并给出 warning 让人知道该刷新页面
//   - 没有 version 字段 → 同样按未知处理。旧后端不写这个字段，我们无法确认它用的是
//     哪套阈值，默认它和当前前端一致是错误的假设。
// /2：U2 落地后 initialSdk 参与 FRESH_BOOT_ON_AGED_ROM 判定，usage 轴能在「镜像新、世代老」
// 的设备上给出真实扣分。这是判定变化，不是形状变化 —— 旧前端若继续用 /1 阈值染色会把这种
// 设备显示成一致。
export const scoreVersion = 'sigmark-score/4';
export const versionMismatchNote = (version: string) =>
  '这份打分来自 ' + version + '，当前界面只认得 ' + scoreVersion +
  '。等级和数字仍按后端原样显示，但颜色已停用——判定规则可能变了，不该用旧阈值给它上色。';
export const undeterminedNote = '没读到不等于正常：这里列的是判断缺口，不是「已通过」。';

// undetermined[].reason 有五种：前四种是字段状态（UNAVAILABLE / RESTRICTED / ERROR /
// NOT_ARCHIVED），回答「App 为什么没读到」；第五种 PROFILE_UNSET 回答的是另一个问题
// ——读到了，但**我们的登记表里没写这颗 SoC 应该是什么值**。把两者混为一谈会让运维
// 去重采样一台设备，而真正该做的是补登记表。所以必须分开显示。
// 不认识的 reason 原样透出是安全的兜底（不猜含义）。
const reasonLabels: Record<string, string> = {
  UNAVAILABLE: '采样时未取得读数',
  RESTRICTED: '系统限制读取',
  NOT_ARCHIVED: '这份报告未保存该字段',
  ERROR: '采集出错',
  PROFILE_UNSET: '该 SoC 已登记但缺期望值',
};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const percent = (value: number | null): string | null => value === null ? null : Math.round(value * 100) + '%';
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function bandOf(raw: unknown): Band {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return bandOrder.includes(text as Band) ? text as Band : '?';
}

// 无 score 字段（旧报告）→ null，调用方整块缺省，不渲染空壳。
export function scoreView(payload: ScorePayload | null | undefined): ScoreView | null {
  if (!payload || typeof payload !== 'object') return null;

  const version = typeof payload.version === 'string' ? payload.version.trim() : '';
  const versionSupported = version === scoreVersion;
  const versionWarning = versionSupported ? null : versionMismatchNote(version || '（未标注版本）');

  const band = bandOf(payload.band);
  const value = finite(payload.value);
  // band=="?" 或 value 不是数字 → 未给分。把「读不到」渲染成 0 或 100 是致命错误。
  // 契约（定死）：band=="?" 时后端把 axes[].score 置 JSON null，但 axes[].coverage 照实给数字。
  // coverage 是「这一轴读到了多少」，跟「给不给分」正交；低覆盖恰恰是没给分的原因，
  // 所以未给分时 coverage 必须照常显示，不能跟着被抹掉。
  const scored = band !== '?' && value !== null;
  const coverage = finite(payload.coverage);
  const caps = list<ScoreCap>(payload.caps).map(cap => {
    const capBand = bandOf(cap.band);
    return {
      code: typeof cap.code === 'string' ? cap.code : '',
      band: capBand,
      bandLabel: bandLabels[capBand],
      reason: typeof cap.reason === 'string' ? cap.reason : '',
    };
  });

  const ledger: LedgerRow[] = [];
  const axes: AxisView[] = list<ScoreAxis>(payload.axes).map(axis => {
    const code = typeof axis.code === 'string' ? axis.code : '';
    const label = typeof axis.label === 'string' && axis.label ? axis.label : code;
    const axisCoverage = finite(axis.coverage);
    const axisScore = finite(axis.score);
    const lowCoverage = axisCoverage !== null && axisCoverage < coverageFloor;
    const rawDeductions = list<Deduction>(axis.deductions);
    // 后端 R7 的薄轴例外：coverage < 0.5 但记了扣分的轴仍然计入总分。
    // 一条已记录的矛盾是事实，不因为它旁边几个通道读不到就作废。
    // 界面必须跟这条规则一致，否则管理员按界面复算会对不上总分。
    const thinButPriced = lowCoverage && rawDeductions.length > 0;
    const counted = scored && axisCoverage !== null && (!lowCoverage || thinButPriced);
    const deductions: DeductionView[] = rawDeductions.map(deduction => {
      const points = Math.abs(finite(deduction.points) ?? 0);
      const row: DeductionView = {
        code: typeof deduction.code === 'string' ? deduction.code : '',
        label: typeof deduction.label === 'string' && deduction.label ? deduction.label : (typeof deduction.code === 'string' ? deduction.code : ''),
        pointsText: '-' + points,
        keys: strings(deduction.keys),
        detail: typeof deduction.detail === 'string' ? deduction.detail : '',
      };
      ledger.push({ ...row, axis: code, axisLabel: label });
      return row;
    });
    // 未计入总分的原因必须写在轴上，不能只体现在一个漂亮的分数里。
    // 未给分与低覆盖可以同时成立：两条都写出来，别让「本次未给分」盖掉「覆盖不足」这个原因。
    const noteParts: string[] = [];
    if (!scored) noteParts.push('本次未给分，不参与合计');
    if (scored && axisScore === null) noteParts.push('该轴没有有效读数，未计入总分');
    if (thinButPriced) noteParts.push('覆盖不足 50%，但已记录的扣分仍计入总分');
    else if (lowCoverage) noteParts.push('覆盖不足 50%，未计入总分');
    if (axisCoverage === null) noteParts.push('覆盖未记录，未计入总分');
    const note = noteParts.length ? noteParts.join(' · ') : null;
    const weight = finite(axis.weight) ?? 0;
    return {
      code, label, weight,
      weightText: '权重 ' + weight,
      score: scored ? axisScore : null,
      scoreText: scored && axisScore !== null ? String(axisScore) : null,
      coverage: axisCoverage,
      coverageText: percent(axisCoverage) ?? '未记录',
      counted, note, deductions,
    };
  });

  const bandLabel = scored
    ? ((typeof payload.bandLabel === 'string' && payload.bandLabel.trim()) || bandLabels[band])
    : bandLabels[band];
  const undetermined: UndeterminedView[] = list<ScoreUndetermined>(payload.undetermined).map(item => {
    const reason = typeof item.reason === 'string' ? item.reason : '';
    return {
      axis: typeof item.axis === 'string' ? item.axis : '',
      axisLabel: typeof item.axis === 'string' ? item.axis : '',
      keys: strings(item.keys),
      reason,
      reasonText: reasonLabels[reason] ?? (reason || '未记录原因'),
    };
  });

  return {
    scored,
    band,
    bandLabel,
    // band=="?" 时大字显示「数据不足，未给分」，绝不出现 0 或 100。
    headline: scored ? bandLabel : unscoredHeadline,
    // 版本不认识就不上色：颜色是「我们按当前阈值认为它属于哪一档」的判断，
    // 阈值可能已经变了，硬染就是用一个过期结论去覆盖一个更新的事实。
    tone: versionSupported ? bandTones[band] : bandTones['?'],
    score: scored ? value : null,
    scoreText: scored ? String(value) : null,
    scoreQualifier: scored ? scoreQualifier : null,
    coverageText: percent(coverage) ?? '未记录',
    coverageLabel: typeof payload.coverageLabel === 'string' ? payload.coverageLabel : '',
    // 契约（定死）：decisive 不是独立信号，它是「caps 非空」的派生布尔。
    // 前端一律取并集（caps 优先），不依赖后端把两个字段写一致：
    //   decisive:false 但 caps 非空 → 后端自相矛盾，这里仍按决定性项渲染。
    decisive: payload.decisive === true || caps.length > 0,
    axes,
    ledger,
    caps,
    hasCaps: caps.length > 0,
    capNotice: caps.length
      ? '决定性项命中 ' + caps.length + ' 条：这一条不参与平均，直接把等级压到 D。'
      : null,
    capExplanation,
    undetermined,
    undeterminedLead,
    undeterminedNote,
    warnings: caps.map(cap => cap.code).filter(Boolean),
    note: scored ? null : unscoredNote,
    version: version || '（未标注版本）',
    versionSupported,
    versionWarning,
  };
}
