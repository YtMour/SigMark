export const fields = [
  ['system.patch','系统安全补丁','ro.build.version.security_patch'],
  ['system.vendorSpl','厂商安全补丁','ro.vendor.build.security_patch'],
  ['environment.verifiedBoot','启动校验状态','ro.boot.verifiedbootstate'],
  ['environment.flashLock','闪存锁定状态','ro.boot.flash.locked'],
  ['system.selinux','SELinux 实时模式','getenforce'],
];
const extraFields = [
  ['environment.vbmetaState','VBMeta 锁定声明','ro.boot.vbmeta.device_state'],
  ['battery.temperature','电池温度','dumpsys battery / temperature（0.1 °C）'],
  ['battery.voltage','电池电压','dumpsys battery / voltage（mV）'],
];
// v3 adds the readings the app is refused but the shell domain can still get.
// They are a separate observer identity, never a replacement for an app value.
const shellOnlyFields = [
  ['system.bootloader','Bootloader 属性','ro.bootloader'],
  ['environment.verityMode','dm-verity 模式','ro.boot.veritymode'],
  ['environment.buildDebuggable','系统可调试声明','ro.debuggable（1/0）'],
  ['battery.sysBatteryTemp','电池驱动温度原值','/sys/class/power_supply/battery/temp（0.1 °C）'],
];
// v4 compares the identity declarations that the app already archives:
// Build values stay in the report, shell values only appear side by side.
const identityFields = [
  ['system.boardPlatform','平台代号声明','ro.board.platform'],
  ['system.bootHardware','启动硬件声明','ro.boot.hardware'],
  ['system.hardwareSku','启动硬件 SKU','ro.boot.hardware.sku'],
];
const extendedIdentityFields = [
  ['system.device','设备代号','ro.product.device'],
  ['system.initialSdk','设备初始 API 级别','ro.product.first_api_level'],
];
const identityKeys = new Set([...identityFields, ...extendedIdentityFields].map(([key]) => key));
export const observationFields = [...fields,...extraFields];
export const shellObservationFields = [...fields,...extraFields,...shellOnlyFields];
export const identityObservationFields = [...shellObservationFields,...identityFields];
export const extendedObservationFields = [...identityObservationFields, ...extendedIdentityFields];
// v5 is the opt-in root view: only the policy digest is new, and the observer is
// never merged with the App row. No rooted device is required to read this file.
const rootFields = [
  ['system.selinuxPolicy','SELinux 策略摘要（root）','su -c sha256sum /sys/fs/selinux/policy'],
];
export const rootObservationFields = [...identityObservationFields,...rootFields];

export function followupFor(row, archive) {
  const key=row.group+'.'+row.key;
  const read=k=>archive.get(k)?.status==='AVAILABLE'?archive.get(k)?.value:null;
  if(key==='battery.sysBatteryTemp'&&read('battery.temperature')!=null)
    return '公开电池 API 已有温度 '+read('battery.temperature')+'；节点原读数保持单列，可用 ADB 观察并列 shell 读数。';
  if(key==='battery.sysBatteryTemp')
    return '节点被系统策略拒绝；M8 等 ROM 连 shell 也读不到。可用 ADB 观察文件并列另一视角读数，不写回本字段。';
  if(key==='system.selinux')return '实时模式可用同设备的 ADB 观察文件复核。';
  if(key==='system.selinuxEvidence')return '记录直接读取或辅助线索。';
  if(key==='system.selinuxPolicy')return '只检查策略文件是否可打开。读取内容需要额外的系统权限。';
  if(key==='environment.buildDebuggable'&&row.status!=='AVAILABLE')
    return 'ROM 可能只对 shell 暴露 ro.debuggable；可用 ADB 观察并列该值，它不代表当前 APK 可调试。';
  if(key==='environment.verityMode'&&row.status!=='AVAILABLE')
    return '可用 ADB 读取 ro.boot.veritymode 并列对照；属性声明不证明镜像内容。';
  if(key==='system.bootloader'&&row.status!=='AVAILABLE')
    return '可用 ADB 读取 ro.bootloader 并列对照；注意同一属性在 App 与 shell 下可能被 ROM 改写。';
  if(key==='cellular.cellLTEBandwidth'){
    const supplemental=read('cellular.carrierBandwidths');
    return supplemental
      ? '订阅载波有独立读数：'+supplemental+'。不等同于该 LTE 小区带宽。'
      : '按频段或信号值推不出单小区带宽；确认蜂窝实际连接后复测。';
  }
  if(row.reason==='PERMISSION_REQUIRED'||row.reason==='LOCATION_DISABLED')
    return '在手机「权限与复测」检查授权和系统位置，再采一份新报告。';
  if(row.reason==='MODEM_NOT_REPORTED'||(row.group==='cellular'&&row.reason==='NOT_REPORTED'))
    return '确认 SIM 就绪及蜂窝状态，在数据启用后重采。不要用已注册小区回填默认数据卡。';
  if(row.reason==='OPTIONAL_UNSET'||row.reason==='INTERFACE_UNSUPPORTED')
    return '此字段取决于系统版本或设备上报；没有读数不等于故障。';
  if(row.status==='ERROR')return '重新采样并核对来源、错误码和复现条件。';
  return '保留当前状态；复测时核对接口、采样条件与时间。';
}

export const maxObservationBytes = 8192;
const appIdentityFields = [['system.model','型号','App 型号声明'], ...identityFields, ...extendedIdentityFields];
export const appIdentityKeys = new Set(appIdentityFields.map(([key]) => key));
const appStatuses = new Set(['AVAILABLE','RESTRICTED','UNAVAILABLE','ERROR','NOT_ARCHIVED']);
const identityText = (value, limit) => typeof value === 'string' && !!value.trim() &&
  value.length <= limit && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);

export function parseAppIdentity(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw Error('文件内容不是有效的 JSON。'); }
  if (data?.schema !== 'sigmark-app-identity/1' || data.observer !== 'APP' ||
      !Number.isSafeInteger(data.capturedAtEpochMs) || data.capturedAtEpochMs < 1 ||
      data.capturedAtEpochMs > 8.64e15 || !identityText(data.collectorVersion, 64) ||
      !data.readings || typeof data.readings !== 'object' || Array.isArray(data.readings)) {
    throw Error('请选择从印迹「指纹安全」保存的身份对照 JSON。');
  }
  const parameters = appIdentityFields.flatMap(([id,label]) => {
    const row = data.readings[id];
    if (!row || !appStatuses.has(row.status) ||
        (row.status === 'AVAILABLE' ? !identityText(row.value, 256) : row.value !== null) ||
        (row.status === 'NOT_ARCHIVED' ? row.source !== null : !identityText(row.source, 160)) ||
        (row.reason !== undefined && (typeof row.reason !== 'string' || !/^[A-Z_]{1,40}$/.test(row.reason))) ||
        (row.errno !== undefined && (!Number.isInteger(row.errno) || row.errno < 1 || row.errno > 4095))) {
      throw Error('App 身份声明字段格式有误。');
    }
    if (row.status === 'NOT_ARCHIVED') return [];
    return [{group:'system',key:id.slice(7),label,value:row.value,status:row.status,source:row.source,
      reason:row.reason,errno:row.errno}];
  });
  const model = parameters.find(row => row.key === 'model')?.value ?? 'unknown';
  return {capturedAtEpochMs:data.capturedAtEpochMs,collectorVersion:data.collectorVersion,model,parameters};
}

const verityPattern=/^[a-z0-9_.-]{1,32}$/;
const shellValuePatterns={
  'environment.verityMode':verityPattern,
  'environment.buildDebuggable':/^(0|1)$/,
  'system.boardPlatform':/^[a-z0-9_.-]{1,32}$/,
  'system.bootHardware':/^[a-z0-9_.-]{1,32}$/,
  'system.hardwareSku':/^[A-Za-z0-9._-]{1,32}$/,
  'system.device':/^[A-Za-z0-9._-]{1,80}$/,
  'system.initialSdk':/^[1-9][0-9]?$/,
};
const integerLimits={'battery.temperature':[-500,1200],'battery.voltage':[1000,15000],'battery.sysBatteryTemp':[-500,1200]};
const extendedProtectionPatterns = {
  'system.patch': /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  'system.vendorSpl': /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  'environment.verifiedBoot': /^(green|yellow|orange|red)$/,
  'environment.flashLock': /^(0|1)$/,
};

export function parseObservation(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw Error('文件内容不是有效的 JSON。'); }
  const schema=data&&data.schema;
  const extended = schema === 'sigmark-adb-evidence/6';
  const model = data?.model;
  const validModel = typeof model === 'string' && !!model.trim() && model.length <= 100 &&
    (!extended || (!/[\p{C}\p{Zl}\p{Zp}]/u.test(model) && !/^(unknown|null)$/i.test(model.trim())));
  if (!data || !['sigmark-adb-evidence/1','sigmark-adb-evidence/2','sigmark-adb-evidence/3','sigmark-adb-evidence/4','sigmark-adb-evidence/5','sigmark-adb-evidence/6'].includes(schema) ||
      !Number.isSafeInteger(data.observedAtEpochMs) || data.observedAtEpochMs < 1 ||
      data.observedAtEpochMs > 8.64e15 || (!validModel && !(extended && model === null)) || !data.readings ||
      typeof data.readings !== 'object' || Array.isArray(data.readings)) {
    throw Error('请选择 SigMark ADB 观察脚本生成的文件。');
  }
  const observer=schema==='sigmark-adb-evidence/5'?'ROOT':'ADB_SHELL';
  if(schema==='sigmark-adb-evidence/5'){
    if(data.observer!=='ROOT') throw Error('root 观察文件缺少 ROOT 来源。');
  }else if(schema!=='sigmark-adb-evidence/1'&&data.observer!=='ADB_SHELL'){
    throw Error('观察文件缺少 ADB shell 来源。');
  }
  const keys = extended ? extendedObservationFields
    :schema==='sigmark-adb-evidence/5'?rootObservationFields
    :schema==='sigmark-adb-evidence/4'?identityObservationFields
    :schema==='sigmark-adb-evidence/3'?shellObservationFields
    :schema==='sigmark-adb-evidence/2'?observationFields:fields;
  const readings = Object.fromEntries(keys.map(([key]) => {
    const value = data.readings[key];
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 80 ||
        /[\x00-\x1f\x7f]/.test(value))) throw Error('ADB 观察文件的字段格式有误。');
    if (key === 'system.selinux' && value !== null && !['Enforcing','Permissive','Disabled'].includes(value)) {
      throw Error('ADB 观察文件中的 SELinux 值不受支持。');
    }
    const limits=integerLimits[key];
    if(value!==null&&limits&&(!/^(0|-?[1-9]\d{0,4})$/.test(value)||Number(value)<limits[0]||Number(value)>limits[1]))
      throw Error('ADB 电池或系统字段超出允许范围。');
    if(key==='environment.vbmetaState'&&value!==null&&!['locked','unlocked'].includes(value))throw Error('ADB VBMeta 状态格式有误。');
    const pattern=shellValuePatterns[key] ?? (extended ? extendedProtectionPatterns[key] : undefined);
    if(value!==null&&pattern&&!pattern.test(value))throw Error('ADB 系统字段格式有误。');
    if(key==='system.bootloader'&&value!==null&&(!/^[A-Za-z0-9._+\- ]{1,80}$/.test(value)||/^(unknown|null)$/i.test(value)))
      throw Error('ADB Bootloader 字符串格式有误。');
    if(key==='environment.verityMode'&&value!==null&&/^(unknown|null)$/i.test(value))
      throw Error('ADB dm-verity 字段是占位值，请写 null。');
    if(key==='system.selinuxPolicy'&&value!==null&&!/^sha256:[0-9a-f]{16,64}$/.test(value))
      throw Error('SELinux 策略摘要格式有误。');
    if(identityKeys.has(key)&&
      value!==null&&/^(unknown|null)$/i.test(value)) throw Error('ADB 身份字段是占位值，请写 null。');
    return [key, value];
  }));
  return {observedAtEpochMs:data.observedAtEpochMs,model:model?.trim()??null,observer,readings};
}

// Old archives may contain a speculative mode. Keep the artifact, but do not
// draw a mode comparison from it.
const appModes=[['Enforcing','Enforcing'],['Permissive','Permissive']];
const modeOf=value=>appModes.find(([prefix])=>value?.startsWith(prefix))?.[1];

function identityClaim(value) {
  const claim = value?.trim().toLowerCase();
  return claim && !['unknown','null'].includes(claim) ? claim : null;
}

function identityFieldClaim(key, value) {
  if (key === 'system.initialSdk' && !shellValuePatterns[key].test(value?.trim() ?? '')) return null;
  return identityClaim(value);
}

export function summarizeObservationIdentity(appModel, archive, observation, confirmed, comparableTime) {
  const fieldsToCompare = [...identityFields, ...extendedIdentityFields.filter(([key]) =>
    observation && Object.hasOwn(observation.readings, key))];
  const total = fieldsToCompare.length + 1;
  if (!observation) return {state:'not_loaded', compared:0, different:0, total};
  if (!confirmed) return {state:'unpaired', compared:0, different:0, total};
  if (!comparableTime) return {state:'stale', compared:0, different:0, total};

  const pairs = [['system.model', appModel, observation.model], ...fieldsToCompare.map(([key]) => {
    const app = archive.get(key);
    return [key, app?.status === 'AVAILABLE' ? app.value : null, observation.readings[key]];
  })];
  let compared = 0;
  let different = 0;
  for (const [key, appValue, externalValue] of pairs) {
    const left = identityFieldClaim(key, appValue);
    const right = identityFieldClaim(key, externalValue);
    if (!left || !right) continue;
    compared++;
    if (left !== right) different++;
  }
  const state = different ? 'different' : compared ? 'matching' : 'insufficient';
  return {state, compared, different, total};
}

export function compareObservation(key, app, adb, comparableTime=true, selinuxBasis) {
  if (app?.status !== 'AVAILABLE' || !app.value || adb == null) return '缺少一方读数';
  if(!comparableTime) return '采样时间不在对照窗口内，仅展示读数';
  const staticIdentity=identityKeys.has(key);
  if(key.startsWith('battery.')){
    // battery.temperature is the app's °C text over dumpsys 0.1 °C; the sysfs node
    // is raw 0.1 °C on both sides; voltage is mV on both sides.
    if(key==='battery.temperature'){
      const appValue=/^(-?\d+(?:\.\d+)?) ?°C$/.exec(app.value)?.[1];
      if(appValue===undefined)return '缺少一方可比较的读数';
      const delta=Math.abs(Number(adb)/10-Number(appValue));
      return delta<=2?'在参考差值内（可能同源）':'超出参考差值，请同条件重采';
    }
    if(key==='battery.sysBatteryTemp'){
      const appValue=/^(-?\d+)$/.exec(app.value)?.[1];
      if(appValue===undefined)return '缺少一方可比较的读数';
      const delta=Math.abs(Number(adb)-Number(appValue));
      return delta<=20?'在参考差值内（可能同源）':'超出参考差值，请同条件重采';
    }
    const appValue=/^(\d+) mV$/.exec(app.value)?.[1];
    if(appValue===undefined)return '缺少一方可比较的读数';
    return Math.abs(Number(adb)-Number(appValue))<=100?'在参考差值内（可能同源）':'超出参考差值，请同条件重采';
  }
  if(key==='environment.buildDebuggable'){
    const appFlag={'关闭':'0','开启':'1'}[app.value.trim()];
    if(appFlag===undefined)return '缺少一方可比较的读数';
    return appFlag===adb.trim()?'读数一致':'读数不同，核对采样时点与来源（App 为 ro.debuggable 的映射值）';
  }
  if(key==='system.selinux'){
    if(app.value.includes('推断')||['inferred_mac','inferred_disabled'].includes(selinuxBasis))
      return 'App 实时模式未确认';
    const left=modeOf(app.value),right=adb.trim();
    if(!left)return '缺少一方可比较的读数';
    if(left!==right)return '读数不同，核对采样时点';
    return '读数一致';
  }
  if(staticIdentity){
    const left=identityFieldClaim(key,app.value),right=identityFieldClaim(key,adb);
    if (!left || !right) return '缺少一方可比较的读数';
    return left===right?'读数一致':
      '读数不同，身份字段不一致。请核对观察来源与采样条件。';
  }
  if(key==='system.bootloader'){
    const left=app.value.trim().toLowerCase(),right=adb.trim().toLowerCase();
    if(left===right)return '读数一致';
    return '读数不同：同一属性在 App 与 shell 下可能被 ROM 改写，两值分别保留';
  }
  const left = app.value.trim().toLowerCase();
  const right = adb.trim().toLowerCase();
  return left === right ? '读数一致' : '读数不同，核对采样时点';
}
