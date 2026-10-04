// 本机可访问地址探测：Node 的 os.networkInterfaces() 在 Windows 上
// 有时看不到 WiFi 网卡（多网卡/虚拟适配器场景），用 ipconfig 兜底补全。
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function kindOf(ip) {
  const m = /^100\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return 'tailscale';
  if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return 'lan';
  return 'lan';
}

// 从 ipconfig 输出解析 [{name, ip}]（中英文系统都能匹配）
async function windowsIpconfig() {
  try {
    const { stdout } = await execFileAsync('ipconfig', [], { windowsHide: true, timeout: 5000 });
    const out = [];
    let adapter = '';
    for (const raw of stdout.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      // 适配器标题行：以 ":" 结尾，如 "以太网适配器 以太网:" / "Wireless LAN adapter WLAN:"
      if (/:\s*$/.test(line) && /(适配器|adapter)/i.test(line)) {
        adapter = line.replace(/:\s*$/, '').replace(/(以太网适配器|无线局域网适配器|Wireless LAN adapter|Ethernet adapter)\s*/g, '').trim();
        continue;
      }
      const m = /IPv4\s*(地址|Address)[^:]*:\s*([\d.]+)/i.exec(line);
      if (m) {
        const ip = m[2];
        if (ip.startsWith('169.254.')) continue; // 自动私有地址，无效
        out.push({ ip, adapter: adapter || '网络' });
      }
    }
    return out;
  } catch { return []; }
}

// 汇总所有可访问地址，WiFi/无线优先（手机一般走 WiFi）
async function listLocalAddresses() {
  const seen = new Map();
  // 1) Node 原生
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const n of nets || []) {
      const fam = n.family === 'IPv4' || n.family === 4;
      if (!fam || n.internal) continue;
      if (n.address.startsWith('169.254.')) continue;
      seen.set(n.address, { ip: n.address, adapter: name, kind: kindOf(n.address) });
    }
  }
  // 2) Windows 兜底（补 Node 漏掉的网卡）
  if (process.platform === 'win32') {
    for (const { ip, adapter } of await windowsIpconfig()) {
      if (!seen.has(ip)) seen.set(ip, { ip, adapter, kind: kindOf(ip) });
    }
  }
  const list = [...seen.values()];
  const isWifi = (a) => /(WLAN|Wi-?Fi|无线)/i.test(a.adapter) ? 0 : 1;
  list.sort((a, b) => isWifi(a) - isWifi(b) || a.ip.localeCompare(b.ip));
  return list;
}

module.exports = { listLocalAddresses, kindOf };
