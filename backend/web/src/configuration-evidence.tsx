import {caption} from './reports';
import type {Parameter} from './compare';

export type ConfigurationCode={
  version:string;
  previousReportId?:string;
  components:{domain:string;code?:string;available:number;inputs:{key:string;reading:Parameter|null;change?:string}[]}[];
};
type Reading=Parameter&{unit?:string};
const names:Record<string,string>={product:'商品配置',hardware:'硬件配置',rom:'ROM 配置'};
const changes:Record<string,string>={gained:'取得读数',lost:'缺少读数',changed:'值变化',status_changed:'状态或原因变化'};
const nodes=[
  ['cpu.sysCpuPossible','内核可支持的逻辑 CPU 编号'],
  ['cpu.sysCpuOnline','采样时在线的逻辑 CPU 编号'],
  ['battery.sysBatteryTemp','电池驱动温度原值'],
];

function cpuList(raw:string|undefined) {
  if(!raw||!/^\d{1,4}(?:-\d{1,4})?(?:,\d{1,4}(?:-\d{1,4})?)*$/.test(raw))return null;
  const cpus=new Set<number>();
  for(const part of raw.split(',')) {
    const [first,last=first]=part.split('-').map(Number);
    if(first>last||last>4095)return null;
    for(let cpu=first;cpu<=last;cpu++)cpus.add(cpu);
  }
  return cpus;
}

function ReadingValue({reading}:{reading:Reading|null|undefined}) {
  if(!reading)return <>该报告未归档</>;
  return <>{reading.value!=null&&<strong>{reading.value}{reading.unit?' · '+reading.unit:''}</strong>}
    <small>{caption(reading.status)}{reading.reason?' · '+caption(reading.reason):''}
      {reading.errno!=null?' · errno='+reading.errno:''}</small>
    <small>{reading.source}</small>{reading.note&&<small>{reading.note}</small>}</>;
}

export function ConfigurationEvidence({code,fields,previousLink}:{code:ConfigurationCode|undefined;fields:Reading[];previousLink?:string}) {
  const index=new Map(fields.map(p=>[p.group+'.'+p.key,p]));
  const available=(key:string)=>{
    const row=index.get(key);
    return row?.status==='AVAILABLE'?row.value??undefined:undefined;
  };
  const possible=cpuList(available('cpu.sysCpuPossible')),online=cpuList(available('cpu.sysCpuOnline'));
  const driver=available('battery.sysBatteryTemp'),battery=available('battery.temperature');
  const apiTemp=battery?.match(/^(-?\d+(?:\.\d+)?) °C$/)?.[1];
  return <div className="configuration-evidence">
    <details><summary><strong>设备配置机器码</strong> · {code?code.components.filter(c=>c.code).length+' 个分量已生成':'当前后台未返回'}</summary>
      <p>仓库归组使用用户选择关联的随机安装标记。手机的旧配置摘要只在本机查看。此处的机器码来自本次归档的商品、硬件和 ROM 字段；三个分量各自独立，相同配置可以同码。</p>
      {code&&<>
        <p>算法 <code>{code.version}</code> · App 归档视角
          {previousLink&&<> · <a href={previousLink}>查看上一次同资产采样</a></>}</p>
        {code.components.map(part=><div key={part.domain}>
          <h5>{names[part.domain]??part.domain} · {part.available}/{part.inputs.length}</h5>
          <p>{part.code?<code>{part.code}</code>:'输入不完整，未生成此分量'}
            {previousLink&&!part.inputs.some(input=>input.change)&&' · 本次未观察到输入变化'}</p>
          <dl className="dossier-meta">{part.inputs.map(input=><div key={input.key}><dt><code>{input.key}</code>
            {input.change&&<small>{changes[input.change]}</small>}</dt><dd><ReadingValue reading={input.reading}/></dd></div>)}</dl>
        </div>)}
      </>}
    </details>
    <details><summary><strong>固定 /sys 节点与公开 API 对照</strong> · {nodes.filter(([key])=>index.has(key)).length}/3 项已归档</summary>
      <p>以普通 App 身份读取，仅作同次采样对照；旧报告缺行保留为未归档。</p>
      <dl className="dossier-meta">{nodes.map(([key,label])=><div key={key}><dt>{label}</dt><dd><ReadingValue reading={index.get(key)}/></dd></div>)}</dl>
      {possible&&online&&<p>{[...online].every(cpu=>possible.has(cpu))?'在线编号是可能编号的子集。':'在线编号超出可能清单，建议复测。'}</p>}
      <p>公开 API 报告当前进程可用核心数，内核在线编号是系统范围，两者口径不同。</p>
      <dl className="dossier-meta"><div><dt>进程可用核心数</dt><dd><ReadingValue reading={index.get('cpu.cores')}/></dd></div>
        <div><dt>公开 API 电池温度</dt><dd><ReadingValue reading={index.get('battery.temperature')}/></dd></div></dl>
      {driver!=null&&apiTemp!=null&&<p>{Math.abs(Number(driver)/10-Number(apiTemp))<=2?'两路电池温度在 2 °C 内。':'两路电池温度相差超过 2 °C，请复核供应商标度与采样时点。'}</p>}
      <p>电池两路可能来自同一驱动。复测请在手机的「更多工具 → 机器码与节点证据」重新采集，再手动上传。</p>
    </details>
  </div>;
}
