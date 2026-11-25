[![codecov](https://codecov.io/gh/chedaroo/cloudflare-ddns-worker/graph/badge.svg?token=04T2XKE4PO)](https://codecov.io/gh/chedaroo/cloudflare-ddns-worker)
![ci](https://github.com/chedaroo/cloudflare-ddns-worker/actions/workflows/ci.yml/badge.svg)
![release](https://img.shields.io/github/v/release/chedaroo/cloudflare-ddns-worker?style=flat)

## 📡 Cloudflare Dynamic DNS Worker

This Cloudflare Worker provides a secure, dynamic DNS update endpoint. It accepts public IP updates from routers or scripts and uses Cloudflare’s API to update or create `A`, `AAAA`, or `CNAME` records as needed.

Originally written for the **UniFi Network**, but it will likely work with any DDNS-capable device that can call a custom URL.

---

## 🚀 Features

- ✅ Automatically updates DNS records

- ✅ Automatically creates missing records

- ✅ Supports `A`, `AAAA`, and `CNAME` types

- ✅ Configurable TTL and proxying

- ✅ Basic Authentication (to protect endpoint)

- ✅ Fully deployable via a single interactive CLI command

---

## 🔧 Requirements

- A domain managed in [Cloudflare](https://dash.cloudflare.com)
- A [Cloudflare API Token](https://dash.cloudflare.com/profile/api-tokens) with:
  - **Zone → DNS → Edit** permissions
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install/)
- Node.js 18 or later

---

## 🛠️ Setup & Deployment

This project includes an interactive deployment script that handles required secrets, variables, and deployment — no `.env` or `wrangler.toml` required.

### 1. Clone and Install

```bash
git clone https://github.com/chedaroo/cloudflare-ddns-worker.git
cd cloudflare-ddns-worker
npm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser window to authenticate your Cloudflare account.

### 3. Deploy the Worker

```bash
npm run deploy
```

The script will prompt you for:

- `BASIC_AUTH_USER` – protects the endpoint
- `BASIC_AUTH_PASS` – protects the endpoint
- `CLOUDFLARE_API_TOKEN` – used internally for Cloudflare API calls, see requirements above

Then it will:

- Deploy the Worker
- Apply the Worker secrets
- Print a summary and your deployed endpoint URL

---

## 🌐 Request Format

Your deployed endpoint will look like:

```
https://cloudflare-ddns-worker.YOURNAME.workers.dev/update
```

### Query Parameters

| Parameter  | Description                            | Default                                       |
| ---------- | -------------------------------------- | --------------------------------------------- |
| `hostname` | Fully-qualified domain name to update  | required                                      |
| `ip`       | IP address to assign                   | required                                      |
| `proxied`  | Whether to proxy via Cloudflare        | `true`                                        |
| `ttl`      | Time-to-live (seconds)                 | `1` (auto)                                    |
| `type`     | DNS record type (`A`, `AAAA`, `CNAME`) | inferred from `ip`: IPv4 → `A`, IPv6 → `AAAA` |

Only the record matching `hostname` **and** `type` is touched, so a dual-stack host keeps separate `A` and `AAAA` records, and other records at the same name (e.g. `TXT`) are never modified. For a `CNAME`, pass the target hostname as `ip` and set `type=CNAME` explicitly.

The zone is found automatically by trying the most specific parent first, so multi-part TLDs (`home.example.co.uk`) and delegated subdomain zones work.

---

## 📶 UniFi Custom DDNS Setup (UDM/UDM-SE)

1. Open **UniFi Network Console**
2. Go to **Settings → Internet → WAN → Advanced → Dynamic DNS**
3. Click **Create New Dynamic DNS**
4. Fill out the form:

| Field        | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| **Service**  | `Custom`                                                                       |
| **Hostname** | Your FQDN (e.g., `home.example.com`)                                           |
| **Username** | Your Basic Auth username (from the deploy prompt)                              |
| **Password** | Your Basic Auth password (from the deploy prompt)                              |
| **Server**   | `https://cloudflare-ddns-worker.YOURNAME.workers.dev/update?hostname=%h&ip=%i` |

> `%h` and `%i` are automatically replaced by UniFi with the configured hostname and your current public IP.

You can also append options like:

```
&proxied=false&ttl=300&type=A
```

---

## 🔐 Security

- Protected via **HTTP Basic Auth**
- The username is passed as a runtime var
- The password and Cloudflare token are securely stored as Worker secrets
- No secrets or sensitive data are committed to version control

---

## 🧠 Why This Exists

Cloudflare doesn't offer native Dynamic DNS functionality. This Worker bridges the gap by securely updating DNS records using standard HTTP requests from routers, servers, or home automation tools.

It’s lightweight, serverless, and requires no dedicated backend — a modern solution that integrates seamlessly with the Cloudflare ecosystem.
