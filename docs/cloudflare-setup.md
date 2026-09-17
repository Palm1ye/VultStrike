# Cloudflare & Domain Setup Guide

This document covers how to configure your domain with Cloudflare for a VultStrike deployment.

## 🌐 DNS Records

In Cloudflare Dashboard > DNS > Records, add the following entries:

### Main Website (Next.js Frontend)
| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | @ | `YOUR_SERVER_IP` | ✅ Proxied | Auto |
| A | www | `YOUR_SERVER_IP` | ✅ Proxied | Auto |

### API Subdomain (NestJS Backend)
| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | api | `YOUR_SERVER_IP` | ✅ Proxied | Auto |

### Game Server (CS2 - Proxy must be OFF!)
| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | game | `YOUR_GAME_SERVER_IP` | ❌ DNS Only | Auto |

> ⚠️ **Important**: Game server proxy must be OFF because CS2 uses UDP ports, which Cloudflare does not proxy.

---

## 🔒 SSL/TLS Settings

**Cloudflare Dashboard > SSL/TLS > Overview**

1. **SSL/TLS encryption mode**: Select `Full (strict)`
   - This ensures traffic between Cloudflare and your server is also encrypted
   - Your server must have a valid SSL certificate (Let's Encrypt recommended)

2. **Edge Certificates** (SSL/TLS > Edge Certificates):
   - Always Use HTTPS: ✅ ON
   - Automatic HTTPS Rewrites: ✅ ON
   - Minimum TLS Version: TLS 1.2

---

## 🚀 Recommended Cloudflare Settings

### Speed > Optimization
- **Auto Minify**: JavaScript, CSS, HTML ✅
- **Brotli**: ✅ ON

### Caching > Configuration
- **Caching Level**: Standard
- **Browser Cache TTL**: 4 hours

### Security > Settings
- **Security Level**: Medium
- **Challenge Passage**: 30 minutes
- **Browser Integrity Check**: ✅ ON

### Rules > Page Rules (Optional)

Disable caching for the API subdomain:
```
URL: api.yourdomain.com/*
Settings: Cache Level = Bypass
```

---

## 🔧 Server-Side Configuration

### 1. Nginx Reverse Proxy (Recommended)

Create `/etc/nginx/sites-available/vultstrike`:

```nginx
# Frontend (Next.js) - Port 3000
server {
    listen 80;
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# API (NestJS) - Port 4000
server {
    listen 80;
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # WebSocket support (for matchmaking)
        proxy_read_timeout 86400;
    }
}
```

### 2. SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate (for all subdomains)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com -d api.yourdomain.com

# Test automatic renewal
sudo certbot renew --dry-run
```

### 3. Firewall Configuration

```bash
# Open required ports with UFW
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 27015/tcp # CS2 Server
sudo ufw allow 27015/udp # CS2 Server
sudo ufw allow 27020/udp # CS2 SRCDS
```

---

## 📝 Environment Files

### apps/api/.env
```env
DATABASE_URL="postgresql://vultstrike:PASSWORD@localhost:5432/vultstrike"
PORT=4000
API_PUBLIC_URL="https://api.yourdomain.com"
WEB_PUBLIC_URL="https://yourdomain.com"
COOKIE_DOMAIN=".yourdomain.com"
COOKIE_SECURE="true"
ORCHESTRATOR_PUBLIC_HOST="game.yourdomain.com"
GAME_SERVER_HOST="game.yourdomain.com"
# ... other settings
```

### apps/web/.env.local
```env
NEXT_PUBLIC_API_BASE="https://api.yourdomain.com"
```

---

## ✅ Setup Checklist

- [ ] DNS records added (A records for root, www, api, game)
- [ ] SSL/TLS set to Full (strict)
- [ ] Nginx reverse proxy configured
- [ ] Let's Encrypt certificate obtained
- [ ] Firewall ports opened
- [ ] Environment files updated with production URLs
- [ ] API CORS settings include production URLs
- [ ] Cookie domain set to `.yourdomain.com`
- [ ] Steam API callback URL updated

---

## 🎮 Steam Developer Portal

Don't forget to update the callback URL for Steam authentication:

1. Go to https://steamcommunity.com/dev/apikey
2. Get or update your API Key
3. Use your domain as the domain value

---

## 🔍 Troubleshooting

### CORS Errors
- Ensure `WEB_PUBLIC_URL` and `API_PUBLIC_URL` values are correct
- Check the browser console for which origin is being rejected

### Cookie Issues
- Ensure `COOKIE_DOMAIN` is set to `.yourdomain.com` (the leading dot is important!)
- `COOKIE_SECURE` must be `true` in production

### WebSocket Connection Issues
- Ensure WebSocket support is enabled in Nginx config
- Check if WebSockets are enabled in Cloudflare (Network > WebSockets)

### Game Server Connection Issues
- Ensure Cloudflare proxy is OFF for the `game` subdomain
- Verify UDP ports are open in the firewall
