import type {Parameter} from './compare.ts';

export const qualityVersion='sigmark-field-quality/1';
export type QualityNote={code:string;dimension:'semantic'|'consistency'|'freshness'|'functional'|'external';text:string;keys?:string[]};
const yearKey='system.gnssHardwareYear', capsKey='system.gnssCapabilities', providerKey='system.gnssProvider';
const ifaceKey='system.interfaceCapabilities', statusKey='system.gnssCheckStatus', measurementsKey='system.gnssCheckMeasurements';

export function gnssYearQuality(raw: string|null, capturedAt?:number) {
  if(raw===null)return 'no_reading';
  if(!/^(0|-?[1-9][0-9]{0,9})$/.test(raw)||Number(raw)<-2147483648||Number(raw)>2147483647)return 'invalid_format';
  const year=Number(raw);
  if(year===0)return 'before_2016';
  if(year<2016)return 'below_min';
  if(!capturedAt||!Number.isFinite(capturedAt))return 'clock_unknown';
  const utc=new Date(capturedAt).getUTCFullYear();
  if(!Number.isFinite(utc)||utc<2000||utc>2099)return 'clock_unknown';
  return year>utc?'future':'reported';
}

export function gnssAudit(fields:Parameter[], capturedAt?:number):QualityNote[] {
  const map=new Map(fields.map(row=>[row.group+'.'+row.key,row]));
  const value=(key:string)=>{
    const row=map.get(key);
    return row?.status==='AVAILABLE'?row.value:null;
  };
  const notes:QualityNote[]=[];
  const add=(dimension:QualityNote['dimension'],code:string,text:string,keys?:string[])=>notes.push({dimension,code,text,keys});
  const semantic=gnssYearQuality(value(yearKey),capturedAt);
  const messages:Record<typeof semantic,string>={
    no_reading:'本报告没有可判读的型号年原值。旧报告的无值状态不会被反推为 0。',
    invalid_format:'原值不符合 Android 整数接口格式，先核对来源。',
    before_2016:'原值 0 是 Android 定义的「型号年早于 2016」，不含具体年份；没有 GPS 提供器时，不据此主张存在旧硬件。',
    below_min:'非零值低于 Android 文档的型号年下限，保留原值，建议重采核对。',
    future:'原值晚于采样墙钟的 UTC 年份，先核对设备时间和系统上报。',
    clock_unknown:'采样墙钟缺失或异常，本报告无法核验未来年份。',
    reported:'原值符合接口语义。GNSS 硬件和软件构建型号年与芯片制造年、手机上市年是不同信息。',
  };
  add('semantic','GNSS_YEAR_'+semantic.toUpperCase(),messages[semantic],[yearKey]);
  const provider=value(providerKey), features=value(ifaceKey), hasFeature=features?.split(' / ').includes('gnss');
  if(features!==null&&provider!==null){
    const agrees=(provider==='yes')===hasFeature;
    add('consistency',agrees?'GNSS_PROVIDER_CONSISTENT':'GNSS_PROVIDER_REVIEW',
      agrees?'公开功能声明与 GPS 提供器列表相符，两者都来自 Android。':'公开功能声明与 GPS 提供器可见性不一致，建议同机重采；这不是设备身份结论。',[ifaceKey,providerKey]);
  }
  const caps=value(capsKey);
  const measurements=value(measurementsKey), status=value(statusKey);
  if(caps!==null&&measurements==='observed'){
    const declared=caps.split(' / ').includes('measurements');
    add('consistency',declared?'GNSS_MEASUREMENTS_CONSISTENT':'GNSS_MEASUREMENTS_REVIEW',
      declared?'测量能力声明与本次非空回调一致。':'未声明测量能力，但本次收到非空测量事件。先核对 ROM 和采样条件。',[capsKey,measurementsKey]);
  }
  const start=value('system.gnssCheckStartAt'), end=value('system.gnssCheckEndAt');
  if(start&&end&&Number(end)<Number(start))add('freshness','GNSS_CLOCK_REVERSED','设备墙钟结束时间早于起点；只用单调时钟核对观测用时。',['system.gnssCheckStartAt','system.gnssCheckEndAt']);
  if(status==='observed'||measurements==='observed')add('functional','GNSS_CALLBACK_OBSERVED','本次前台窗口内收到非空回调；只证明该观测链路当时有数据，不验证型号年。',[statusKey,measurementsKey]);
  else if(map.has(statusKey)||map.has(measurementsKey))add('functional','GNSS_NOT_CONFIRMED','本次没有取得非空回调证据。查看起点条件、窗口和字段状态；不能推出硬件故障。',[statusKey,measurementsKey]);
  else add('functional','GNSS_NOT_RUN','本报告未归档 GNSS 前台实测；不等于实测失败。',[statusKey,measurementsKey]);
  add('external','GNSS_NO_INDEPENDENT_PROOF','这些是 Android App 视角的声明和功能实测；同一 GNSS 服务/HAL 的多个接口不构成独立证明。');
  return notes;
}

export function otherFieldQuality(field:Parameter):QualityNote|null {
  if(field.group!=='network'||field.key!=='wifiFrequency'||field.status!=='AVAILABLE'||field.value==null)return null;
  // Broad readout sanity only; regulatory channel validity is a separate question.
  const number=/^([0-9]{4,5}) MHz$/.exec(field.value)?.[1];
  const f=Number(number);
  return Number.isFinite(f)&&f>=2300&&f<=71000?null:
    {dimension:'semantic',code:'WIFI_FREQ_REVIEW',text:'频率的 MHz 格式或范围偏离当前采集契约，建议在相同 Wi-Fi 下重采。原始值未修改。'};
}
