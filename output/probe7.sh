PID=$(pidof com.sigmark.app)
echo "=== GPU / graphics libs in maps ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | grep -oE '/(vendor|system|apex)[^ ]*lib[^ ]*(mali|adreno|GLES|vulkan|ged)[^ ]*\.so' | sort -u | head -12
echo "=== apex versions in maps ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | grep -oE '/apex/[a-zA-Z0-9._]+@[0-9]+' | sort -u | head -8
echo "=== meminfo extras (app uid) ==="
run-as com.sigmark.app grep -E '^(MemTotal|CmaTotal|SwapTotal|VmallocTotal)' /proc/meminfo 2>&1
echo "=== cpu capacity ==="
for i in 0 4 7; do printf "cpu%s: " $i; run-as com.sigmark.app cat /sys/devices/system/cpu/cpu$i/cpu_capacity 2>&1; done