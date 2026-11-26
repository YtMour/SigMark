echo "=== GPU driver nodes (app uid) ==="
for p in /sys/class/kgsl /sys/class/kgsl/kgsl-3d0 /sys/class/misc/mali0 /sys/kernel/ged /sys/kernel/gpu /sys/class/devfreq; do
  if run-as com.sigmark.app ls $p >/dev/null 2>&1; then echo "READABLE $p"; else echo "DENIED   $p"; fi
done
echo "=== mali0 detail ==="
run-as com.sigmark.app cat /sys/class/misc/mali0/device/gpuinfo 2>&1 | head -3
echo "=== devfreq list ==="
run-as com.sigmark.app ls /sys/class/devfreq 2>&1 | head -10
echo "=== mountinfo dm names ==="
run-as com.sigmark.app grep -oE '/dev/block/dm-[0-9]+' /proc/self/mountinfo 2>&1 | sort -u | head -8
echo "=== preinstalled miui packages visible to app ==="
run-as com.sigmark.app pm list packages 2>&1 | grep -c miui