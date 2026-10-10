# Setup and Configuration

This guide covers getting your Telegram API credentials, setting up your Python environment, and configuring `.env`.

---

## 1. Prerequisites

- **Python 3.9+**
- A registered Telegram account that has already joined the target channel.

---

## 2. Obtain Telegram API Credentials

Telethon connects directly to Telegram servers using the MTProto protocol as a user client.

1. Open [my.telegram.org](https://my.telegram.org) and log in with your Telegram phone number.
2. Navigate to **API development tools**.
3. Create a new application (app title and short name can be anything).
4. Save the displayed **`api_id`** (integer) and **`api_hash`** (hex string).

> [!WARNING]
> Keep your `api_hash` and the generated `session.session` file private. They grant full user access to your Telegram account.

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

Create a `.env` file in the root directory:

```env
API_ID=12345678
API_HASH=0123456789abcdef0123456789abcdef
CHANNEL=-1001234567890
SAVE_DIR=downloads
SESSION_NAME=session
MAX_RETRIES=5
```

### Parameter Reference

| Variable | Type | Description |
|---|---|---|
| `API_ID` | Integer | Your Telegram API ID from [my.telegram.org](https://my.telegram.org). |
| `API_HASH` | String | Your Telegram API hash from [my.telegram.org](https://my.telegram.org). |
| `CHANNEL` | String / Integer | Channel username (without `@`), invite link, or numeric channel ID (e.g., `-100...`). |
| `SAVE_DIR` | String | Directory where downloaded media and `manifest.json` are written. Defaults to `downloads`. |
| `SESSION_NAME`| String | Name of the SQLite session file. Defaults to `session`. |
| `MAX_RETRIES` | Integer | Max attempts per file on network/RPC failures before recording failure. Defaults to `5`. |

---

## 5. First-Time Authentication

On the initial execution, Telethon prompts for interactive authentication in your terminal:

1. **Phone number**: Enter your international number (e.g. `+1234567890`).
2. **Login code**: Enter the verification code received inside your Telegram app.
3. **2FA Password**: Enter your two-step verification cloud password if enabled.

Once completed, a `<SESSION_NAME>.session` file is created. Subsequent executions will authenticate automatically.
