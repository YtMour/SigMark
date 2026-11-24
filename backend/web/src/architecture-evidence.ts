export const architectureKeys=['cpu.processBitness','cpu.abis','cpu.kernelMachine'] as const;
const abi32=new Set(['armeabi','armeabi-v7a','x86','mips','riscv32']);
const abi64=new Set(['arm64-v8a','x86_64','mips64','riscv64']);
const kernel32=new Set(['armv7l','armv8l','i386','i486','i586','i686','mips','riscv32']);
const kernel64=new Set(['aarch64','arm64','x86_64','mips64','riscv64']);

export function architectureEvidence(process?:string,abis?:string,machine?:string){
  const bits=process?.trim();
  if(bits!=='32'&&bits!=='64')return 'insufficient';
  const widths=abis?.split(',').map(abi=>{
    const name=abi.trim().toLowerCase();
    return abi32.has(name)?'32':abi64.has(name)?'64':null;
  })??[];
  const kernel=machine?.trim().toLowerCase()??'';
  if(bits==='64'&&(kernel32.has(kernel)||(widths.length&&widths.every(w=>w==='32'))))return 'conflict';
  return (kernel32.has(kernel)||kernel64.has(kernel))&&widths.includes(bits)?'compatible':'insufficient';
}
