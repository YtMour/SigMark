import type { Parameter } from './compare';

type Metric = {key:string;status:string;reason?:string};
export type Row = {id:string;batch:string;receivedAt:string;trashedAt?:string;report:{schemaVersion:number;model:string;androidApi:number;appVersion:string;network:string;collectorVersion?:string|null;fieldSetVersion?:number|null}};
export type CoverageGroup = {group:string;available:number;restricted:number;unavailable:number;errors:number};
export type Report = Row & {report:{capturedAtEpochMs:number;feedback?:string;metrics:Metric[];parameters?:Parameter[];coverage?:CoverageGroup[]}};
export type Page = {items:Row[];nextCursor:string};
export type Summary = {total:number;status:Record<string,number>;network:Record<string,number>};
export const groups:Record<string,string>={system:'系统与固件',cpu:'内核与 CPU',memory:'内存与存储',display:'屏幕与显示',battery:'电池',sensors:'传感器',network:'Wi-Fi 与网络',cellular:'移动网络',runtime:'系统能力与运行时',media:'相机、音频与外设',environment:'安全与环境线索',app:'应用与权限'};
const labels:Record<string,string>={AVAILABLE:'可用',RESTRICTED:'受限',UNAVAILABLE:'暂无数据',ERROR:'读取异常',wifi:'Wi-Fi',cellular:'移动网络',ethernet:'以太网',vpn:'VPN',none:'离线',unknown:'未知',other:'其他',
  PERMISSION_REQUIRED:'需用户授权',LOCATION_DISABLED:'系统位置关闭',ACCESS_DENIED:'系统拒绝访问',NOT_REPORTED:'未上报或未暴露',READ_FAILED:'读取失败',OPTIONAL_UNSET:'可选字段未提供',INTERFACE_UNSUPPORTED:'接口不提供',MODEM_NOT_REPORTED:'调制解调器未上报',NO_REGISTERED_LTE:'无已注册 LTE 小区',NODE_MISSING:'节点未暴露',INVALID_VALUE:'状态未确认',
  'system.selinux':'SELinux 实时模式','cpu.kernelFull':'内核编译信息','network.wifiFrequency':'Wi-Fi 频率','network.internetValidation':'互联网验证','cellular.dataRat':'蜂窝制式','cellular.cellDiagnostics':'小区无线参数'};
export const caption=(value:string)=>labels[value]??value;
export const date=(value:string|number)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
export const shortDate=(v:string)=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

export function saveJson(data:Report){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='SigMark-'+data.id+'.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
