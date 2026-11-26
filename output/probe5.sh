PID=$(pidof com.sigmark.app)
echo "=== deleted mappings ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | grep deleted | awk '{print $1, $2, $6, $7, $8}' | head -20
echo "=== .so under /data or /memfd ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -E '\.so$|memfd' | sort -u | grep -vE '^/(system|apex|vendor|product|odm|system_ext)' | head -20
echo "=== resource-cache idmap names ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | grep -o '/data/resource-cache/[^ ]*' | sort -u
echo "=== can app list /data/resource-cache? ==="
run-as com.sigmark.app ls /data/resource-cache 2>&1 | head -20