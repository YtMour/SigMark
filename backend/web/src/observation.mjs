export const fields = [
  ['system.patch','系统安全补丁','ro.build.version.security_patch'],
  ['system.vendorSpl','厂商安全补丁','ro.vendor.build.security_patch'],
  ['environment.verifiedBoot','启动校验状态','ro.boot.verifiedbootstate'],
  ['environment.flashLock','闪存锁定状态','ro.boot.flash.locked'],
  ['system.selinux','SELinux 实时模式','getenforce'],
];

export const maxObservationBytes = 8192;

export function parseObservation(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw Error('文件内容不是有效的 JSON。'); }
  if (!data || data.schema !== 'sigmark-adb-evidence/1' ||
      !Number.isSafeInteger(data.observedAtEpochMs) || data.observedAtEpochMs < 1 ||
      data.observedAtEpochMs > 8.64e15 || typeof data.model !== 'string' ||
      !data.model.trim() || data.model.length > 100 || !data.readings ||
      typeof data.readings !== 'object' || Array.isArray(data.readings)) {
    throw Error('请选择 SigMark ADB 观察脚本生成的文件。');
  }
  const readings = Object.fromEntries(fields.map(([key]) => {
    const value = data.readings[key];
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 80 ||
        /[\x00-\x1f\x7f]/.test(value))) throw Error('ADB 观察文件的字段格式有误。');
    if (key === 'system.selinux' && value !== null && !['Enforcing','Permissive','Disabled'].includes(value)) {
      throw Error('ADB 观察文件中的 SELinux 值不受支持。');
    }
    return [key, value];
  }));
  return {observedAtEpochMs:data.observedAtEpochMs,model:data.model.trim(),readings};
}

const mode = new Map([
  ['Enforcing（强制模式）','Enforcing'],
  ['Permissive（宽容模式）','Permissive'],
]);

export function compareObservation(key, app, adb) {
  if (app?.status !== 'AVAILABLE' || !app.value || adb == null) return '缺少一方读数';
  const left = key === 'system.selinux' ? mode.get(app.value) : app.value.trim().toLowerCase();
  const right = key === 'system.selinux' ? adb : adb.trim().toLowerCase();
  if (!left) return '缺少一方可比较的读数';
  return left === right ? '读数一致' : '读数不同，核对采样时点';
}
