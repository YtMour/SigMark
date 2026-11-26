import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  bandLabels,bandOrder,bandTones,capExplanation,coverageFloor,scoreQualifier,scoreView,
  undeterminedLead,unscoredHeadline,
} from '../src/score-view.ts';

// 契约样本：GET /api/admin/reports/{id}/device-profile 顶层 score（version=sigmark-score/4）。
const payload=()=>({
  version:'sigmark-score/4',
  value:62,band:'C',bandLabel:'可疑',coverage:0.73,coverageLabel:'部分可判',decisive:false,
  axes:[
    {code:'declaration',label:'声明一致性',weight:40,score:45,coverage:0.9,deductions:[
      {code:'FOREIGN_PROFILE',label:'hardware_declaration_conflict',points:30,keys:['memory.cmaTotal'],
        detail:'652 MiB 与 gs101 画像一致'}]},
    {code:'behavior',label:'行为风险',weight:35,score:100,coverage:1,deductions:[]},
    {code:'usage',label:'使用真实性',weight:25,score:100,coverage:0.4,deductions:[]},
  ],
  caps:[{code:'DECISIVE_FOREIGN_PROFILE',band:'D',reason:'实测值等于另一颗已登记 SoC 的画像'}],
  undetermined:[{axis:'declaration',keys:['cpu.cpuCapacity'],reason:'UNAVAILABLE'}],
});
const unscored=()=>({...payload(),value:null,band:'?',bandLabel:'未知',decisive:true,
  axes:payload().axes.map(axis=>({...axis,score:null})),
  undetermined:[{axis:'declaration',keys:['cpu.cpuCapacity'],reason:'UNAVAILABLE'},
    {axis:'usage',keys:['usage.sessionCount'],reason:'RESTRICTED'}]});

// 真机实测样本：android-34 仿真器（sigmark-emu34）报告
// ff32a085-bc4a-42b0-88d0-ed13ce21f23b 的 score 原文，逐字取自 API，不是手写的。
// 它钉住的是后端 P0 缺陷修复后的正确形态：决定性命中 + 覆盖不足时，
// band 是 D（结论），value 是 null（数字），两者同时成立且互不矛盾。
const emulator=()=>JSON.parse(readFileSync(new URL('./fixtures-emulator-score.json',import.meta.url))).score;

test('a real decisive emulator capture renders D with no number, and both facts coexist',()=>{
  const raw=emulator();
  // 前置断言：这份 fixture 必须真的是那个形态，否则下面的断言在测空气。
  assert.equal(raw.decisive,true);
  assert.equal(raw.band,'D');
  assert.equal(raw.value,null);
  assert.ok(raw.coverage<0.7,'这份样本的覆盖必须偏低，才代表 P0 的触发条件');
  const view=scoreView(raw);
  // band 是结论，必须显示；value 是数字，必须不显示。
  assert.equal(view.scored,false,'value 为 null 时不得给出数字');
  assert.equal(view.band,'D');
  assert.equal(view.bandLabel,'高度可疑');
  // 决定性警告必须置顶且解释原因——不能让管理员以为 0.67 的覆盖只是「数据不足」。
  assert.ok(view.caps.length>=1);
  assert.match(view.caps[0].code,/DECISIVE/);
  assert.match(view.caps[0].reason,/构建标记|模拟器/);
  // 三个轴都不给分，但覆盖照实显示，不能被抹成 0。
  for(const axis of view.axes){
    assert.equal(axis.scoreText,null,axis.code);
    assert.ok(axis.coverage!==null,axis.code);
  }
  // 唯一一条扣分必须落在 behavior，且带完整溯源。
  const ledger=view.ledger;
  assert.equal(ledger.length,1);
  assert.equal(ledger[0].code,'VIRTUAL_BUILD_MARKERS');
  assert.equal(ledger[0].axis,'behavior');
  assert.equal(ledger[0].pointsText,'-35');
  assert.deepEqual(ledger[0].keys,['cpu.hardware','system.product','system.device']);
  assert.ok(ledger[0].detail.length>0,'扣分必须有一句话 detail');
});

// 三条声明轴分支共用同一个 label（hardware_declaration_conflict），所以账本行必须
// 靠 code 区分。Pixel 6 真机就是这个形态：FOREIGN_PROFILE 30 + OVERLAY_CODENAME_MISMATCH 15。
test('deductions sharing one label stay distinguishable by their branch code',()=>{
  const raw={...payload(),value:82,band:'B',bandLabel:'有疑点',decisive:true,coverage:0.94,
    axes:[
      {code:'declaration',label:'声明一致性',weight:40,score:55,coverage:1,deductions:[
        {code:'FOREIGN_PROFILE',label:'hardware_declaration_conflict',points:30,
          keys:['cpu.cpuCapacity','memory.cmaTotal'],detail:'与 gs101 画像一致'},
        {code:'OVERLAY_CODENAME_MISMATCH',label:'hardware_declaration_conflict',points:15,
          keys:['system.device','environment.overlayDeviceCodename'],detail:'corot 与 oriole 不一致'},
      ]},
      {code:'behavior',label:'行为风险',weight:35,score:100,coverage:0.83,deductions:[]},
      {code:'usage',label:'使用真实性',weight:25,score:100,coverage:1,deductions:[]},
    ],
    caps:[{code:'DECISIVE_FOREIGN_PROFILE',band:'D',reason:'实测值等于另一颗已登记 SoC 的画像'}],
    undetermined:[]};
  const view=scoreView(raw);
  const rows=view.ledger.filter(row=>row.axis==='declaration');
  assert.equal(rows.length,2);
  // 同一个 label 出现两次，这是契约允许的；但 code 必须不同，否则界面上两行长得一样。
  assert.equal(rows[0].label,rows[1].label);
  assert.notEqual(rows[0].code,rows[1].code);
  assert.deepEqual(rows.map(row=>row.code).sort(),['FOREIGN_PROFILE','OVERLAY_CODENAME_MISMATCH']);
  // 后端按 points 降序输出，账本保留这个顺序，重的那条先读。
  assert.deepEqual(rows.map(row=>row.pointsText),['-30','-15']);
});

// 后端现在对 deductions 与 undetermined 都做了确定性排序，前端不得再自己重排，
// 否则「同样的两次采集产生同样的文档」在界面上就断了。
test('the ledger preserves backend order instead of re-sorting',()=>{
  const raw={...payload(),axes:[
    {code:'declaration',label:'声明一致性',weight:40,score:55,coverage:1,deductions:[
      {code:'AAA_LAST',label:'x',points:5,keys:['a'],detail:''},
      {code:'ZZZ_FIRST',label:'y',points:40,keys:['b'],detail:''},
    ]},
    {code:'behavior',label:'行为风险',weight:35,score:100,coverage:1,deductions:[]},
    {code:'usage',label:'使用真实性',weight:25,score:100,coverage:1,deductions:[]},
  ]};
  const view=scoreView(raw);
  assert.deepEqual(view.ledger.map(row=>row.code),['AAA_LAST','ZZZ_FIRST']);
});

test('band=="?" with a null value is 未给分 and carries no numeric score at all',()=>{
  const view=scoreView(unscored());
  assert.equal(view.scored,false);
  assert.equal(view.headline,unscoredHeadline);
  assert.equal(view.score,null);
  assert.equal(view.scoreText,null);
  assert.equal(view.scoreQualifier,null);
  // 每条轴也不许冒出数字分：读不到被渲染成 100 是致命错误。
  for(const axis of view.axes){
    assert.equal(axis.scoreText,null,axis.code);
    assert.equal(axis.score,null,axis.code);
    assert.match(axis.note,/未给分/);
  }
  const shown=[view.headline,view.scoreText,view.scoreQualifier,...view.axes.map(a=>a.scoreText)].join(' ');
  assert(!/\d/.test(shown),'未给分视图里不应出现任何数字分：'+shown);
  // 缺了哪些通道要列出来，而不是只说「数据不足」。
  assert.deepEqual(view.undetermined.map(u=>u.axis),['declaration','usage']);
  assert.deepEqual(view.undetermined[0].keys,['cpu.cpuCapacity']);
  assert.equal(view.undetermined[1].reasonText,'系统限制读取');
});

test('band is the main product and the score is secondary with the 仅用于排序 qualifier',()=>{
  const view=scoreView(payload());
  assert.equal(view.scored,true);
  assert.equal(view.band,'C');
  assert.equal(view.headline,'可疑');
  assert.equal(view.scoreText,'62');
  assert.equal(view.scoreQualifier,scoreQualifier);
  assert.equal(scoreQualifier,'仅用于排序');
  assert.equal(view.coverageText,'73%');
});

test('an axis below the coverage floor is explicitly excluded from the total',()=>{
  const view=scoreView(payload());
  const usage=view.axes.find(axis=>axis.code==='usage');
  const declaration=view.axes.find(axis=>axis.code==='declaration');
  assert.equal(coverageFloor,0.5);
  assert.equal(usage.coverage,0.4);
  assert.equal(usage.counted,false);
  assert.match(usage.note,/未计入总分/);
  assert.equal(declaration.counted,true);
  assert.equal(declaration.note,null);
  assert.equal(declaration.coverageText,'90%');
});

// 契约（定死）：band=="?" 时 axes[].score 为 JSON null，但 axes[].coverage 照实给数字。
// coverage 回答「这一轴读到了多少」，跟「给不给分」正交；低覆盖正是没给分的原因，
// 所以未给分时 coverage 必须照常显示，不能被抹成 0，否则用户看不到为什么没给分。
test('an unscored report still shows each axis coverage instead of flattening it to 0',()=>{
  const view=scoreView(unscored());
  const usage=view.axes.find(axis=>axis.code==='usage');
  assert.equal(usage.coverage,0.4);
  assert.equal(usage.coverageText,'40%');
  assert.match(usage.coverageText,/0\.4|40%/,'coverage 文案里必须还能看到 0.4');
  assert.notEqual(usage.coverage,0,'未给分不等于把 coverage 置 0');
  assert.equal(usage.counted,false);
  // 未给分与低覆盖同时成立：两个原因都要写出来。
  assert.match(usage.note,/未计入总分/);
  assert.match(usage.note,/未给分/);
  const full=view.axes.find(axis=>axis.code==='behavior');
  assert.equal(full.coverageText,'100%');
  assert.equal(full.counted,false);
  assert.equal(full.note,'本次未给分，不参与合计');
  // 整条未给分视图里唯一的数字来自 coverage，不来自分数。
  assert.equal(view.coverageText,'73%');
  for(const axis of view.axes)assert.equal(axis.scoreText,null,axis.code);
});

// 后端的 R7 有一条薄轴例外：coverage < 0.5 但记了扣分的轴仍然计入总分。
// 界面必须跟这条规则一致 —— 把「有扣分的薄轴」标成「未计入总分」会让管理员
// 按界面复算时对不上总分，也会低估这条轴的权重贡献。
test('a thin axis that carries a deduction is still counted, and says so',()=>{
  const base=payload();
  const view=scoreView({...base,axes:base.axes.map(axis=>
    axis.code==='declaration'?{...axis,coverage:0.33,score:70,deductions:[
      {code:'IDENTITY_APP_UID',label:'identity_conflict',axis:'declaration',points:25,
       keys:['system.model','system.propertyModel'],detail:'模型对不一致'}]}:axis)});
  const declaration=view.axes.find(axis=>axis.code==='declaration');
  assert.equal(declaration.coverage,0.33);
  assert.equal(declaration.counted,true,'带扣分的薄轴必须计入总分');
  assert.match(declaration.note,/仍计入总分/);
  assert.doesNotMatch(declaration.note,/未计入总分/,
    '不能说「未计入」，后端确实把它算进了加权平均');
  // 低覆盖但没有任何扣分：这条轴确实不进总分，文案保持原样。
  const bare=scoreView({...base,axes:base.axes.map(axis=>
    axis.code==='declaration'?{...axis,coverage:0.33,score:null,deductions:[]}:axis)});
  const bareAxis=bare.axes.find(axis=>axis.code==='declaration');
  assert.equal(bareAxis.counted,false);
  assert.match(bareAxis.note,/未计入总分/);
});

test('undetermined reasons cover the four field states and pass unknown codes through',()=>{
  assert.deepEqual(Object.keys({UNAVAILABLE:1,RESTRICTED:1,NOT_ARCHIVED:1,ERROR:1}).sort(),
    ['ERROR','NOT_ARCHIVED','RESTRICTED','UNAVAILABLE']);
  const view=scoreView({...payload(),undetermined:[
    {axis:'declaration',keys:['a'],reason:'UNAVAILABLE'},
    {axis:'declaration',keys:['b'],reason:'RESTRICTED'},
    {axis:'behavior',keys:['c'],reason:'NOT_ARCHIVED'},
    {axis:'usage',keys:['d'],reason:'ERROR'},
    {axis:'usage',keys:['e'],reason:'SOMETHING_NEW'},
  ]});
  assert.deepEqual(view.undetermined.map(u=>u.reasonText),[
    '采样时未取得读数','系统限制读取','这份报告未保存该字段','采集出错','SOMETHING_NEW']);
});

test('a decisive cap pins the band and is explained instead of averaged away',()=>{
  // 契约（定死）：decisive 是「caps 非空」的派生布尔，不是独立信号。
  // 判定取并集、caps 优先；后端写成 decisive:false + caps 非空也不许被它带偏。
  const view=scoreView(payload());
  assert.equal(payload().decisive,false,'fixture 故意让后端自相矛盾');
  assert.equal(view.hasCaps,true);
  assert.equal(view.decisive,true);
  assert.deepEqual(view.caps.map(cap=>cap.code),['DECISIVE_FOREIGN_PROFILE']);
  assert.equal(view.caps[0].band,'D');
  assert.match(view.capNotice,/不参与平均/);
  assert.match(view.capNotice,/D/);
  assert.match(view.capExplanation,/平均/);
  assert.deepEqual(view.warnings,['DECISIVE_FOREIGN_PROFILE']);
  assert.equal(scoreView({...payload(),caps:[]}).hasCaps,false);
  assert.equal(scoreView({...payload(),caps:[],decisive:true}).decisive,true);
});

test('the deduction ledger keeps every row with points, label, keys and detail',()=>{
  const view=scoreView(payload());
  assert.equal(view.ledger.length,1);
  const [row]=view.ledger;
  assert.equal(row.pointsText,'-30');
  assert.equal(row.label,'hardware_declaration_conflict');
  assert.equal(row.code,'FOREIGN_PROFILE');
  assert.deepEqual(row.keys,['memory.cmaTotal']);
  assert.equal(row.detail,'652 MiB 与 gs101 画像一致');
  assert.equal(row.axis,'declaration');
  assert.equal(row.axisLabel,'声明一致性');
  // 账本是逐条的，不折叠成一个「共扣 N 分」的合计。
  const many={...payload(),axes:[{code:'declaration',label:'声明一致性',weight:40,score:45,coverage:0.9,deductions:[
    {code:'FOREIGN_PROFILE',label:'hardware_declaration_conflict',points:30,keys:['memory.cmaTotal'],detail:'a'},
    {code:'STALE_DECLARATION',label:'hardware_declaration_conflict',points:8,keys:['cpu.cpuCapacity'],detail:'b'}]}]};
  const rows=scoreView(many).ledger;
  assert.deepEqual(rows.map(r=>r.pointsText),['-30','-8']);
  assert.deepEqual(rows.map(r=>r.keys),[['memory.cmaTotal'],['cpu.cpuCapacity']]);
  assert.deepEqual(rows.map(r=>r.detail),['a','b']);
  assert(!('total' in view));
});

test('a report without score yields null so the block stays absent, not an empty shell',()=>{
  assert.equal(scoreView(undefined),null);
  assert.equal(scoreView(null),null);
  // 空对象也不能被当成「满分」或「0 分」。
  const empty=scoreView({});
  assert.equal(empty.scored,false);
  assert.equal(empty.scoreText,null);
  assert.equal(empty.headline,unscoredHeadline);
  const panel=readFileSync(new URL('../src/score-panel.tsx',import.meta.url),'utf8');
  assert.match(panel,/if\(!view\)return null;/);
  assert.match(panel,/import \{scoreView/);
});

test('all five band labels map, and each band headlines its own label',()=>{
  assert.deepEqual(bandOrder,['A','B','C','D','?']);
  assert.deepEqual(bandLabels,{A:'一致',B:'有疑点',C:'可疑',D:'高度可疑','?':'未知'});
  for(const band of bandOrder){
    const view=scoreView({...payload(),band,bandLabel:bandLabels[band],value:band==='?'?null:70});
    // bandLabel 五档各自成立；band=="?" 时大字换成本次未给分（不显示 0 或 100）。
    assert.equal(view.bandLabel,bandLabels[band],band);
    assert.equal(view.headline,band==='?'?unscoredHeadline:bandLabels[band],band);
    assert.equal(view.tone,bandTones[band],band);
    assert.equal(view.scored,band!=='?',band);
  }
  // 后端没给 bandLabel 时用本地五档映射兜底。
  assert.equal(scoreView({...payload(),bandLabel:undefined}).headline,'可疑');
  assert.equal(undeterminedLead,'这些通道没读到，所以本次判断不覆盖它们。');
});

// 版本协商（§8.4）。升到 sigmark-score/4 之后阈值可能变，一个还停在 /1 的前端
// 如果照旧按 A≥85 染色，会把 /4 判成 C 的设备染成 B——颜色是给人看的结论，染错比不染更糟。
test('an unknown score version stops colouring instead of guessing',()=>{
  const raw={...payload(),version:'sigmark-score/5'};
  const view=scoreView(raw);
  // 数字和 band 是后端算的，前端不许改写。
  assert.equal(view.band,'C');
  assert.equal(view.score,62);
  assert.equal(view.scored,true);
  // 但颜色必须停用：我们不知道 /5 的阈值是不是还是 A≥85。
  assert.equal(view.tone,bandTones['?'],'未知版本不得沿用本版颜色');
  assert.notEqual(view.tone,bandTones.C);
  // 必须明说，不能静默降级。
  assert.equal(view.versionSupported,false);
  assert.equal(view.version,'sigmark-score/5');
  assert.ok(view.versionWarning.includes('sigmark-score/5'));
  assert.ok(view.versionWarning.includes('颜色已停用'));
});

// 缺 version 字段同样按未知处理。旧后端不写这个字段，我们无法确认它用的是哪套阈值，
// 默认它和当前前端一致是错误的假设——这恰恰是「跨版本安全」要防的情况。
test('a payload without a version field is treated as unknown, not as current',()=>{
  const view=scoreView({...payload(),version:undefined});
  assert.equal(view.versionSupported,false);
  assert.equal(view.tone,bandTones['?']);
  assert.ok(view.versionWarning.includes('未标注版本'));
});

// 认识的版本必须完全不受影响：这条测试防止「降级逻辑」变成「永远降级」。
test('the current version keeps its colour and carries no warning',()=>{
  const view=scoreView(payload());
  assert.equal(view.versionSupported,true);
  assert.equal(view.versionWarning,null);
  assert.equal(view.tone,bandTones.C);
  assert.equal(view.version,'sigmark-score/4');
});

// 真实仿真器样本本身就是 /1，必须走正常路径——用真机数据兜住这次改动。
test('the real emulator capture is still a supported version',()=>{
  const raw=emulator();
  const view=scoreView(raw);
  assert.equal(raw.version,'sigmark-score/4');
  assert.equal(view.versionSupported,true);
  assert.equal(view.versionWarning,null);
  assert.equal(view.tone,bandTones.D);
});

// 第五个 reason（§8.4 / §13 F12）。它不是字段状态，是「我们登记表缺值」。
// 混成前四种会让运维去重采一台采集完全正常的设备，而真正该做的是补登记表。
test('PROFILE_UNSET is rendered as our own data gap, not as an unread field',()=>{
  const raw={...payload(),undetermined:[
    {axis:'declaration',keys:['memory.cmaTotal'],reason:'PROFILE_UNSET'},
    {axis:'declaration',keys:['environment.overlayDeviceCodename'],reason:'UNAVAILABLE'},
  ]};
  const view=scoreView(raw);
  const unset=view.undetermined.find(item=>item.reason==='PROFILE_UNSET');
  assert.ok(unset,'PROFILE_UNSET must survive into the view');
  assert.equal(unset.reasonText,'该 SoC 已登记但缺期望值');
  assert.deepEqual(unset.keys,['memory.cmaTotal']);
  // 与字段状态的文案必须不同，否则两种缺口在界面上无法区分。
  const unavailable=view.undetermined.find(item=>item.reason==='UNAVAILABLE');
  assert.notEqual(unset.reasonText,unavailable.reasonText);
  // 未识别的 reason 不得静默变成空字符串：原样透出比留白诚实。
  const unknown=scoreView({...payload(),undetermined:[{axis:'declaration',keys:['x'],reason:'SOMETHING_NEW'}]});
  assert.equal(unknown.undetermined[0].reasonText,'SOMETHING_NEW');
});
