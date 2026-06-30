# ⚔️ Kesatria Penghubung Baja Hitam

**SillyTavern Extension - OpenClaw Bridge**

Connect your SillyTavern to Termux/OpenClaw via a bridge server.

## 🎯 Features

- ✅ Enable/Disable toggle from SillyTavern UI
- ✅ Real-time connection status indicator
- ✅ Configurable bridge URL
- ✅ Auto-connect on startup option
- ✅ Debug logging
- ✅ Seamless integration with SillyTavern

## 📦 Installation

### From GitHub (Recommended)

1. Open SillyTavern
2. Go to **Extensions** panel
3. Click **Install Extension**
4. Paste this URL:
   ```
   https://github.com/latifmuzakki144-beep/kesatria-penghubung-baja-hitam
   ```
5. Click **Install**

### Manual Installation

1. Clone this repository:
   ```bash
   cd /path/to/SillyTavern/data/default-user/extensions/
   git clone https://github.com/latifmuzakki144-beep/kesatria-penghubung-baja-hitam.git
   ```
2. Restart SillyTavern

## ⚙️ Configuration

### Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Bridge URL** | URL of the bridge server | *(empty)* |
| **Session ID** | Unique session identifier | Auto-generated |
| **Auto-connect** | Connect automatically on startup | `false` |
| **Debug Mode** | Enable debug logging | `false` |

### Bridge Server

The bridge server is a separate Node.js application that:
1. Receives requests from Termux/OpenClaw
2. Forwards them to SillyTavern
3. Returns responses back to Termux/OpenClaw

See [openclaw-bridge-server](https://github.com/latifmuzakki144-beep/openclaw-bridge-server) for the bridge server setup.

## 🚀 Usage

1. **Start the bridge server** on your Termux/OpenClaw
2. **Get the bridge URL** (e.g., from Cloudflare tunnel)
3. **Open SillyTavern** and go to Extensions
4. **Enter the bridge URL** in the settings
5. **Click Enable** to connect

### Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| 🟢 Connected | Green | Bridge is connected and ready |
| 🟡 Processing | Yellow | Processing a request |
| 🔴 Error | Red | Connection error |
| ⚫ Disconnected | Gray | Not connected |

## 🔧 API Endpoints

The extension communicates with the bridge server using these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/register` | POST | Register a session |
| `/poll` | GET | Poll for pending requests |
| `/response` | POST | Send response back |

## 🐛 Debugging

Enable debug mode in the extension settings to see detailed logs in the browser console.

## 📝 Changelog

### v2.1.0
- Warrior Command Center UI redesign with full animations
- Complex layout with tabs system (Status, Activity, Character, Settings)
- Ambient particle effects & health indicator
- Activity log with filters (all/conn/send/recv/err/info) and pause/clear
- Processing bar with multi-step progress animation & timer
- Latency monitor & uptime tracker
- Stats dashboard (sent / received / errors / polls)
- Character tab with avatar, personality, scenario preview
- Quick actions: send message, generate, get chat history
- Message & generate composers with character counters

### v2.0.0
- Warrior Command Center UI redesign
- Hermes can now send messages AS user
- Get chat history endpoint
- Get character info endpoint
- Tabbed settings panel

### v1.0.0
- Initial release
- Basic bridge functionality
- UI with status indicator
- Settings panel

## 🤝 Contributing

Feel free to submit issues and pull requests!

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

## 🙏 Credits

- **Author:** latifmuzakki144-beep
- **Inspired by:** GeminiRP Bridge Manager

---

⚔️ **Kesatria Penghubung Baja Hitam** - The Black Steel Connecting Knight
