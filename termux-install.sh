#!/data/data/com.termux/files/usr/bin/bash
# 为了明日 · 手机版安装脚本（在 Termux 里运行）
# 用法：先在手机浏览器登录 Gitee 下载仓库 ZIP 并解压，
#       然后在 Termux 里进入解压出的文件夹，运行：bash termux-install.sh
set -e

echo ""
echo "======================================"
echo "  为了明日 · 手机版安装"
echo "======================================"
echo ""

echo "[1/5] 安装运行环境（nodejs-lts，首次约 1-3 分钟）..."
pkg install -y nodejs-lts

SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/for-tomorrow"

echo "[2/5] 复制程序到 $APP ..."
rm -rf "$APP"
mkdir -p "$APP"
cp -r "$SRC"/. "$APP"/
cd "$APP"

echo "[3/5] 安装依赖（约 1 分钟）..."
npm install --no-audit --no-fund

echo "[4/5] 创建启动脚本..."
cat > "$APP/start.sh" <<'START'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
termux-wake-lock 2>/dev/null
# 兼容不同 Node 版本的 sqlite 支持方式
if node -e "require('node:sqlite')" 2>/dev/null; then
  FLAGS=""
else
  FLAGS="--experimental-sqlite"
fi
echo ""
echo "  为了明日 · 考研学习终端（手机版）"
echo "  浏览器打开 http://localhost:5175"
echo "  停止：按 音量减+C，或通知栏退出会话"
echo ""
node $FLAGS server.js
START
chmod +x "$APP/start.sh"

# Termux:Widget 桌面快捷方式（如果装了 Termux:Widget 插件就会出现在桌面长按列表里）
mkdir -p "$HOME/.shortcuts"
cat > "$HOME/.shortcuts/为了明日.sh" <<WEOF
#!/data/data/com.termux/files/usr/bin/bash
bash "$APP/start.sh"
WEOF
chmod +x "$HOME/.shortcuts/为了明日.sh"

termux-wake-lock 2>/dev/null || true

echo "[5/5] 完成！"
echo ""
echo "  启动方式：输入  bash start.sh"
echo "  然后浏览器打开  http://localhost:5175"
echo "  （建议：浏览器菜单 → 添加到主屏幕）"
echo ""
echo "  现在自动启动一次..."
echo ""
node -e "require('node:sqlite')" 2>/dev/null && FLAGS="" || FLAGS="--experimental-sqlite"
node $FLAGS server.js
