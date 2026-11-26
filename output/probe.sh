echo "--- sensors"; dumpsys sensorservice | grep -c "^0x"
echo "--- cameras"; dumpsys media.camera | grep -E "Number of camera devices|Camera ID" | head -5
echo "--- kernel"; cat /proc/version
echo "--- cpuinfo"; grep -E "Hardware|Revision" /proc/cpuinfo | sort -u
echo "--- cpufreq"; for i in 0 4 6 7; do printf "cpu%s: " "$i"; cat /sys/devices/system/cpu/cpu$i/cpufreq/cpuinfo_max_freq; done
echo "--- battery"; cat /sys/class/power_supply/battery/voltage_now; cat /sys/class/power_supply/battery/cycle_count 2>/dev/null
echo "--- display mode"; dumpsys display | grep -m3 -E "mBaseDisplayInfo|real [0-9]+ x [0-9]+|fps"