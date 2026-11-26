echo "=== A. uname by uid ==="
echo -n "shell: "; uname -r
echo -n "runas: "; run-as com.sigmark.app uname -r 2>&1
echo "=== B. props shell vs runas ==="
for p in ro.product.model ro.product.device ro.soc.model ro.board.platform ro.boot.hardware ro.build.fingerprint ro.build.version.release ro.build.version.sdk ro.system.build.date.utc ro.boot.verifiedbootstate ro.boot.flash.locked ro.debuggable ro.build.type ro.build.tags ro.product.first_api_level; do
  a=$(getprop $p); b=$(run-as com.sigmark.app getprop $p 2>/dev/null)
  if [ "$a" = "$b" ]; then echo "SAME  $p = $a"; else echo "DIFF  $p : shell=$a | app=$b"; fi
done
echo "=== C. /proc by uid ==="
echo -n "shell meminfo: "; grep MemTotal /proc/meminfo
echo -n "runas meminfo: "; run-as com.sigmark.app grep MemTotal /proc/meminfo 2>&1
echo -n "runas cpuinfo parts: "; run-as com.sigmark.app grep "CPU part" /proc/cpuinfo 2>&1 | sort -u | tr "\n" " "; echo
echo -n "runas version: "; run-as com.sigmark.app cat /proc/version 2>&1
echo -n "runas uptime: "; run-as com.sigmark.app cat /proc/uptime 2>&1
echo -n "runas stat: "; run-as com.sigmark.app head -1 /proc/stat 2>&1