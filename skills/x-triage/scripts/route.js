// scripts/route.js — Platform routing table for x-triage downstream skills
const ROUTE_TABLE = {
  web: {
    reproduceTemplate: "browser-console",
    investigateTools: ["chrome-devtools-mcp", "lighthouse", "network-capture"],
  },
  mobile: {
    reproduceTemplate: "adb-logcat",
    investigateTools: ["react-native-debugger", "xcode-instruments", "android-studio-profiler"],
  },
  tv: {
    reproduceTemplate: "vendor-bridge",
    investigateTools: ["vendor-dev-tools"],
  },
  backend: {
    reproduceTemplate: "node-standalone",
    investigateTools: ["node-inspect", "gdb-lldb", "strace", "flame-graphs"],
  },
  gaming: {
    reproduceTemplate: "engine-cli",
    investigateTools: ["unity-profiler", "unreal-insights", "renderdoc", "gpu-frame-debugger"],
  },
};

module.exports = { ROUTE_TABLE };
