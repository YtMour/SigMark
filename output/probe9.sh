PID=$(pidof com.sigmark.app)
echo "pid=$PID"
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | awk '{print $6}' | grep -E '\.so$' | sort -u | grep -E 'GLES|mali|adreno|vulkan|/apex/' | head -10
echo "--- apex version strings"
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | grep -oE '/apex/[a-zA-Z0-9._]+@[0-9]+' | sort -u | head -6
echo "--- .so total"
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | awk '{print $6}' | grep -cE '\.so$'