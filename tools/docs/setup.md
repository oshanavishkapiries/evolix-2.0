# Setup and Configuration

This guide covers getting your Telegram API credentials, setting up your Python virtual environment, configuring system tools, and managing `.env` environment variables for all tools in the suite.

---

## 1. Prerequisites

- **Python 3.9+**
- A registered Telegram account that has already joined the target channel.
- **FFmpeg & FFprobe** (optional, required only for `extract_subtitles.py`):
  ```bash
  # Debian / Ubuntu
  sudo apt update && sudo apt install -y ffmpeg

  # macOS
  brew install ffmpeg
  ```

---

## 2. Obtain Telegram API Credentials

Telethon connects directly to Telegram servers using the MTProto protocol as a user client.

1. Open [my.telegram.org](https://my.telegram.org) and log in with your Telegram phone number.
2. Navigate to **API development tools**.
3. Create a new application (app title and short name can be anything).
4. Save the displayed **`api_id`** (integer) and **`api_hash`** (hex string).

> [!WARNING]
> Keep your `api_hash` and the generated `<SESSION_NAME>.session` SQLite file private. They grant full user access to your Telegram account.

---

## 3. Environment Installation

Clone or navigate to the project directory and create a virtual environment:

```bash
# Linux / macOS
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

```powershell
# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

---

## 4. Environment Variables (`.env`)

Create a `.env` file in `/home/ubuntu/PROJECTS/evolix-2.0/tools/.env` (or copy from `env.example`):

```env
# Telegram MTProto Credentials
API_ID=15410532
API_HASH=0123456789abcdef0123456789abcdef
CHANNEL=sinhalaaaa
SAVE_DIR=downloads
SESSION_NAME=session
MAX_RETRIES=5

# Subtitle Extraction Settings
SUBTITLE_DIR=subtitles
SUBTITLE_LANG=all
SUBTITLE_FORMAT=srt

# Pixeldrain API Configuration
PIXELDRAIN_API_KEY=your_pixeldrain_api_key_here

# Evolix Platform Admin Credentials (for catalog publishing)
ADMIN_EMAIL=your_admin_email_here
ADMIN_PASS=your_admin_password_here
```

### Parameter Reference

| Variable | Type | Description | Default |
|---|---|---|---|
| `API_ID` | Integer | Telegram API ID from [my.telegram.org](https://my.telegram.org) | Required |
| `API_HASH` | String | Telegram API hash from [my.telegram.org](https://my.telegram.org) | Required |
| `CHANNEL` | String / Int | Channel username (without `@`) or numeric ID (e.g., `-100...`) | Required |
| `SAVE_DIR` | String | Directory where downloaded media and `manifest.json` are written | `downloads` |
| `SESSION_NAME` | String | Name of the SQLite session file | `session` |
| `MAX_RETRIES` | Integer | Max attempts per file on network/RPC failures before recording failure | `5` |
| `SUBTITLE_DIR` | String | Output directory for extracted subtitle files | `subtitles` |
| `SUBTITLE_LANG` | String | Subtitle language filter (`sin`, `eng`, `all`) | `all` |
| `SUBTITLE_FORMAT`| String | Target subtitle format (`srt`, `vtt`, `ass`) | `srt` |
| `PIXELDRAIN_API_KEY`| String | Pixeldrain REST API key for direct streaming uploads | Optional / Tool-specific |
| `ADMIN_EMAIL` | String | Evolix admin user email for pipeline catalog publishing | Optional / Pipeline-specific |
| `ADMIN_PASS` | String | Evolix admin user password | Optional / Pipeline-specific |

---

## 5. First-Time Authentication

On the initial execution of any Telethon script (`tg_downloader.py` or `run_50_pipeline.py`), Telethon prompts for interactive authentication in your terminal:

1. **Phone number**: Enter your international number (e.g. `+1234567890`).
2. **Login code**: Enter the verification code received inside your Telegram app.
3. **2FA Password**: Enter your two-step verification cloud password if enabled.

Once completed, a `<SESSION_NAME>.session` file is created. Subsequent executions will authenticate automatically.
