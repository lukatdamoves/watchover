# WatchOver Azure VM Deployment Guide (Maximum Security)

This tutorial migrates WatchOver from AWS EC2 to Microsoft Azure using a hardened production setup.

This guide is reusable for other projects. Replace the sample values in the table below before deployment.

## Quick Replace Table (Template)

| Item | Sample in Guide | Replace With |
|------|------------------|--------------|
| Project name | `WatchOver` | `YOUR_PROJECT_NAME` |
| Resource group | `rg-watchover-prod` | `rg-YOUR_PROJECT-prod` |
| VM name | `vm-watchover-prod` | `vm-YOUR_PROJECT-prod` |
| Public IP resource | `pip-watchover-prod` | `pip-YOUR_PROJECT-prod` |
| NSG | `nsg-watchover-prod` | `nsg-YOUR_PROJECT-prod` |
| Linux username | `WatchOver` | `YOUR_ADMIN_USERNAME` |
| App path | `/var/www/html` | `/var/www/YOUR_PROJECT` |
| Domain | `your-domain.com` | `YOUR_DOMAIN` |

Note on username: Azure/Linux may require lowercase usernames on some images. If `WatchOver` is rejected, use `watchover`.

Chosen setup:
- Hosting: Azure VM (Ubuntu)
- Database: MySQL on same VM (localhost only)
- Deployment: Local `git push` to Azure bare repo (`post-receive` auto-deploy)

---

## 1) Create Azure Infrastructure (Azure Portal)

This section follows the exact step-by-step Tabs when creating a VM in the Azure Portal.

### 1.1 Create Virtual Machine (Basics Tab)
1. Open Azure Portal.
2. Go to `Virtual machines` -> `Create` -> `Azure virtual machine`.
3. In the **Basics** tab, configure the following:

- Project details:
  - Subscription: choose your active subscription.
  - Resource group: click `Create new` and name it `watchover`.
- Instance details:
  - Virtual machine name: `watchover`
  - Region: `Southeast Asia` (or nearest stable region).
  - Security type: `Trusted launch virtual machines`
  - Configure security features: keep defaults enabled for Trusted Launch
  - Image: `Ubuntu Server 24.04 LTS - x64 Gen2`
  - VM architecture: `x64`
  - Run with Azure Spot discount: `Off`
  - Size: `Standard_B1s` or `B2s`
- Administrator account:
  - Authentication type: `Password`
  - Username: `WatchOver`
  - Password: set a long unique password
- Inbound port rules:
  - Public inbound ports: `None` (we will control this via NSG rules only).

Click **Next: Disks**.

### 1.2 Disks Tab
- Keep all default settings (Premium SSD is recommended but Standard is fine for cost).
- Click **Next: Networking**.

### 1.3 Networking Tab
Keep everything default, except for the Public IP and NSG settings:

- Under **Public IP**, click `Create new`.
- Keep everything default in the popup and click `OK`.
- **NIC network security group**: `Basic`
- **Public inbound ports**: `Allow selected ports`
- **Select inbound ports**: Check `HTTP (80)`, `HTTPS (443)`, and `SSH (22)`
- Load balancing options: `None`

Click **Review + create**, wait for validation, then click **Create**.

### 1.4 Add Port Rules for MQTT
Once the VM is created and running:
1. Go to the new VM in the Azure Portal.
2. Under the **Networking** section on the left menu, select **Network settings**.
3. Click **Create port rule** -> **Inbound port rule**.
4. Set **Destination port ranges** to `9001` (for MQTT WebSocket).
5. Set **Protocol** to `TCP`.
6. Name the rule `allow-mqtt-wss`.
7. Click **Add**.

Create one more inbound rule for raw MQTT:
1. Click **Create port rule** -> **Inbound port rule**.
2. Set **Destination port ranges** to `1883`.
3. Set **Protocol** to `TCP`.
4. Name the rule `allow-mqtt-raw`.
5. Click **Add**.

Warning: exposing `1883` without MQTT authentication is insecure and temporary. Keep `3306` (MySQL) private.

### 1.7 Azure CLI
Azure provides a built-in browser and CLI connection method directly from the portal

1. Go to your new VM in the Azure Portal.
2. In the left menu, click **Connect**.
3. Go to **More ways to connect** and click **SSH using Azure CLI**.
---

## 2) Initial Server Setup (CLI Commands)

Connect to your VM using the Azure Portal (`Connect` -> `More ways to connect` -> `SSH using Azure CLI`).
Once the black terminal window opens, run the following commands.

### 2.0 SSH into the actual VM first (important)
If you run commands directly in Azure Cloud Shell, `sudo` may fail with `no new privileges`.

From Cloud Shell, SSH into your VM first:

```bash
ssh WatchOver@YOUR_VM_PUBLIC_IP
```

If your username is lowercase:

```bash
ssh watchover@YOUR_VM_PUBLIC_IP
```

enter the password you set in 1.1


### 2.1 Update Ubuntu Packages
Always start by making sure the base OS is fully up to date:

```bash
sudo apt update && sudo apt upgrade -y
```

### 2.2 Configure UFW Firewall
This is your exact next step after 2.1. We need to tell the Ubuntu firewall to allow web and SSH traffic, plus MQTT ports.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 1883/tcp
sudo ufw allow 9001/tcp
sudo ufw --force enable
sudo ufw status verbose
```

### 2.3 Install Bruteforce Protection (fail2ban)
Since this server is on the public internet, bots will immediately try to brute-force your SSH password.

```bash
sudo apt install -y fail2ban unattended-upgrades
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

*(Note: We are not disabling password authentication yet, to ensure you don't lock yourself out of the Azure CLI shell while building the server).*

---

## 3) Install App Stack (Apache, PHP, MySQL)

### 3.1 Install packages

```bash
sudo apt install -y apache2 mysql-server \
  php php-cli php-mysql php-curl php-mbstring php-xml php-zip php-opcache \
  git unzip curl
```

### 3.2 Secure MySQL

```bash
sudo mysql_secure_installation
```

### 3.3 Bind MySQL to localhost only

```bash
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
```

Ensure:

```text
bind-address = 127.0.0.1
```

Then:

```bash
sudo systemctl restart mysql
```

### 3.4 Install Composer
Install Composer on the server so PHP dependencies can be installed after each deployment.

```bash
cd /tmp
curl -sS https://getcomposer.org/installer -o composer-setup.php
sudo php composer-setup.php --install-dir=/usr/local/bin --filename=composer
composer --version
```

---

## 4) Install and Secure Mosquitto (MQTT)

### 4.1 Install

```bash
sudo apt install -y mosquitto mosquitto-clients
```

### 4.2 Authentication note (match current api.php)
Your current `api.php` publishes to MQTT without username/password. To keep it working as-is, this guide exposes MQTT publicly without auth for now.

Warning: this is not production-safe. Anyone who can reach port `1883` can publish/subscribe.

### 4.3 Configure broker

```bash
sudo nano /etc/mosquitto/conf.d/watchover.conf
```

Use:

allow_anonymous true

listener 1883 0.0.0.0
protocol mqtt

listener 9001 0.0.0.0
protocol websockets


Optional hardening later:
- Restrict port `1883` to known source IPs/devices in Azure NSG.
- If you want MQTT username/password, set `allow_anonymous false`, add `password_file /etc/mosquitto/passwd`, create a user with `mosquitto_passwd`, and update MQTT publish code to send credentials.
- Prefer TLS (`8883`) and disable unauthenticated `1883` after device migration.

Restart:

```bash
sudo mosquitto -c /etc/mosquitto/mosquitto.conf -v
sudo systemctl enable mosquitto
sudo systemctl restart mosquitto
```

---

## 5) Domain + TLS (HTTPS + WSS)

### 5.1 Point DNS (works for any domain provider, including get.tech)

Before editing DNS, get your VM public IP from Azure Portal:
1. Open your VM in Azure Portal.
2. Go to **Overview**.
3. Copy the **Public IP address**.

Then update DNS at your domain provider (get.tech or any registrar):
1. Log in to your domain dashboard.
2. Open **DNS Management** or **Manage DNS** for your domain.
3. Add or edit an **A** record for the host you will use.
4. Set it to your Azure VM public IP.
5. Save changes and wait for DNS propagation.

Recommended records:
- Host `@` -> Type `A` -> Value `YOUR_AZURE_PUBLIC_IP` (root domain)
- Host `www` -> Type `A` -> Value `YOUR_AZURE_PUBLIC_IP` (optional)

Important: do not point `@` and `www` to different IPs, or one hostname may timeout.

Notes for get.tech:
- The names may be **Domain List** -> **Manage** -> **DNS**.
- Some dashboards call host `@` as **blank host** or **root**.
- TTL can stay default (for example 300 or 600).

Verify DNS before certbot:

```bash
nslookup your-domain.com
nslookup www.your-domain.com
```

Both should resolve to your Azure VM public IP.

### 5.2 Apache modules

```bash
sudo a2enmod rewrite headers ssl
```

### 5.3 Create virtual host

```bash
sudo nano /etc/apache2/sites-available/watchover.conf
```

Put this config inside:

```apache
<VirtualHost *:80>
  ServerName your-domain.com
  ServerAlias www.your-domain.com
  DocumentRoot /var/www/html

  <Directory /var/www/html>
    AllowOverride All
    Require all granted
    Options -Indexes
    DirectorySlash Off
  </Directory>

  # Block sensitive files even if .htaccess is bypassed
  <FilesMatch "(^\.env|^\.git|composer\.(json|lock)|^\.htaccess)$">
    Require all denied
  </FilesMatch>

  # Security headers
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-XSS-Protection "1; mode=block"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"

  RewriteEngine On

  # Redirect root to login (must be first)
  RewriteRule ^$ https://your-domain.com/login [R=302,L]

  # Extra hard block for direct .env requests
  RewriteRule "(^|/)\.env$" - [F,L,NC]

  # Block direct vendor browsing
  RewriteRule ^vendor(/|$) - [F,L]

  # Canonical clean URLs - redirect .html to clean URLs
  RewriteCond %{THE_REQUEST} \s/+login/login\.html(?:\s|\?) [NC]
  RewriteRule ^login/login\.html$ /login [R=301,L]

  RewriteCond %{THE_REQUEST} \s/+dashboard/dashboard\.html(?:\s|\?) [NC]
  RewriteRule ^dashboard/dashboard\.html$ /dashboard [R=301,L]

  # Internal mapping for clean routes
  RewriteRule ^login$ /login/login.html [L]
  RewriteRule ^dashboard$ /dashboard/dashboard.html [L]

  # Redirect /login/ (with trailing slash) to /login (no slash)
  RewriteCond %{THE_REQUEST} \s/+login/(\s|$|\?) [NC]
  RewriteRule ^login/$ /login [R=301,L]

  # Redirect /dashboard/ (with trailing slash) to /dashboard (no slash)
  RewriteCond %{THE_REQUEST} \s/+dashboard/(\s|$|\?) [NC]
  RewriteRule ^dashboard/$ /dashboard [R=301,L]

  # Keep A9G GPS ingest on HTTP if the device cannot follow HTTPS redirects
  RewriteCond %{REQUEST_URI} ^/api\.php$ [NC]
  RewriteCond %{QUERY_STRING} (^|&)action=save_gps(&|$) [NC]
  RewriteRule ^ - [L]

  # Keep phpMyAdmin tunnel on HTTP localhost (avoid ERR_SSL_PROTOCOL_ERROR)
  RewriteCond %{REQUEST_URI} ^/phpmyadmin(/|$) [NC]
  RewriteRule ^ - [L]

  # Redirect all other HTTP requests to HTTPS
  RewriteRule ^ https://your-domain.com%{REQUEST_URI} [R=301,L]
</VirtualHost>
```

Important: keep only one HTTP-to-HTTPS redirect rule in this file.
If certbot adds extra rewrite lines like `RewriteCond %{SERVER_NAME}` / `RewriteRule ... %{SERVER_NAME}`, remove them from `watchover.conf`.

If your A9G can send directly to HTTPS, remove the exception above and force HTTPS for all routes.


Enable site:

```bash
sudo a2ensite watchover.conf
sudo a2dissite 000-default.conf
sudo systemctl reload apache2
```

### 5.4 Install certbot

```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d your-domain.com -d www.your-domain.com
sudo certbot renew --dry-run
```

### 5.5 Enable HSTS and headers in SSL vhost
After certbot creates SSL vhost, do this exact sequence:

1. Find the SSL vhost file created by certbot:

```bash
ls /etc/apache2/sites-available | grep -E "ssl|letsencrypt|le-ssl"
```

2. Find which SSL vhost is actually active:

```bash
sudo apache2ctl -S | grep -- "*:443"
```

If two domain SSL files are enabled (for example both `your-domain-le-ssl.conf` and `your-domain.com-le-ssl.conf`), keep only one and disable the duplicate.

```bash
sudo a2dissite your-domain.com-le-ssl.conf
sudo systemctl reload apache2
sudo apache2ctl -S
```

3. Open the active SSL vhost file (example names: `watchover-le-ssl.conf`, `your-domain.com-le-ssl.conf`):

```bash
sudo nano /etc/apache2/sites-available/YOUR_ACTIVE_SSL_FILE.conf
```

4. Inside the `<VirtualHost *:443>` block, add:

```apache
<Directory /var/www/html>
  AllowOverride All
  Require all granted
  Options -Indexes
  DirectorySlash Off
</Directory>

<FilesMatch "(^\.env|^\.git|composer\.(json|lock)|^\.htaccess)$">
  Require all denied
</FilesMatch>

<FilesMatch "\.(css|js|html)$">
  Header set Cache-Control "public, max-age=604800, must-revalidate"
</FilesMatch>

<FilesMatch "\.(jpg|jpeg|png|gif|ico|svg|webp)$">
  Header set Cache-Control "public, max-age=2592000"
</FilesMatch>

RewriteEngine On

# Redirect root to login (must be first)
RewriteRule ^$ /login [R=302,L]

RewriteRule "(^|/)\.env$" - [F,L,NC]
RewriteRule ^vendor(/|$) - [F,L]

# Canonical clean URLs - redirect .html to clean URLs
RewriteCond %{THE_REQUEST} \s/+login/login\.html(?:\s|\?) [NC]
RewriteRule ^login/login\.html$ /login [R=301,L]

RewriteCond %{THE_REQUEST} \s/+dashboard/dashboard\.html(?:\s|\?) [NC]
RewriteRule ^dashboard/dashboard\.html$ /dashboard [R=301,L]

# Internal mapping for clean routes
RewriteRule ^login$ /login/login.html [L]
RewriteRule ^dashboard$ /dashboard/dashboard.html [L]

# Redirect /login/ (with trailing slash) to /login (no slash)
RewriteCond %{THE_REQUEST} \s/+login/(\s|$|\?) [NC]
RewriteRule ^login/$ /login [R=301,L]

# Redirect /dashboard/ (with trailing slash) to /dashboard (no slash)
RewriteCond %{THE_REQUEST} \s/+dashboard/(\s|$|\?) [NC]
RewriteRule ^dashboard/$ /dashboard [R=301,L]

Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
Header always set X-Frame-Options "SAMEORIGIN"
Header always set X-Content-Type-Options "nosniff"
Header always set X-XSS-Protection "1; mode=block"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```


5. Ensure headers module is enabled:

```bash
sudo a2enmod headers
```

6. Validate Apache config:

```bash
sudo apache2ctl configtest
```

You should see `Syntax OK`.

7. Reload Apache:

```bash
sudo systemctl reload apache2
```

8. Verify headers are live:

```bash
curl -I https://your-domain.com
```

You should see the 4 security headers in the response.

9. Verify sensitive files are blocked on both HTTP and HTTPS:

```bash
curl -I http://your-domain.com/.env
curl -I https://your-domain.com/.env
```

Expected result is `403 Forbidden` (or any non-200 response).

10. Block direct-IP HTTPS access (prevents bypass through `https://SERVER_IP/...`):

Create a catch-all SSL vhost:

```bash
sudo nano /etc/apache2/sites-available/000-ip-block-ssl.conf
```

Paste:

```apache
<IfModule mod_ssl.c>
<VirtualHost _default_:443>
  ServerName _
  SSLEngine on
  SSLCertificateFile /etc/letsencrypt/live/your-domain.com/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem
  Include /etc/letsencrypt/options-ssl-apache.conf

  <Location "/">
    Require all denied
  </Location>
</VirtualHost>
</IfModule>
```

Enable it and disable default SSL site:

```bash
sudo a2ensite 000-ip-block-ssl.conf
sudo a2dissite default-ssl.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Verify direct IP is blocked:

```bash
curl -k -I https://YOUR_SERVER_PUBLIC_IP/
curl -k -I https://YOUR_SERVER_PUBLIC_IP/.env
```

Expected result is `403 Forbidden` (or any non-200 response).

### 5.6 Enable Secure MQTT WebSocket (`wss://your-domain.com:9001`)
Use this if your dashboard connects directly to `wss://your-domain.com:9001`.

1. Create Mosquitto cert directory and copy certbot certs (readable by mosquitto):

```bash
sudo mkdir -p /etc/mosquitto/certs
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /etc/mosquitto/certs/fullchain.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem /etc/mosquitto/certs/privkey.pem
sudo chown mosquitto:mosquitto /etc/mosquitto/certs/fullchain.pem /etc/mosquitto/certs/privkey.pem
sudo chmod 640 /etc/mosquitto/certs/fullchain.pem /etc/mosquitto/certs/privkey.pem
```

2. Configure Mosquitto listeners:

```bash
sudo nano /etc/mosquitto/conf.d/watchover.conf
```

Use:

```conf
allow_anonymous true

listener 1883 0.0.0.0
protocol mqtt

listener 9001 0.0.0.0
protocol websockets
certfile /etc/mosquitto/certs/fullchain.pem
keyfile /etc/mosquitto/certs/privkey.pem
```

3. Restart Mosquitto and verify listener:

```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto --no-pager
sudo ss -ltnp | grep 9001
```

4. Keep firewall/NSG open for `9001/tcp`.

5. Dashboard client should use:

```text
wss://your-domain.com:9001
```

---

## 6) Deploy WatchOver via Git Push to Azure Server

### 6.1 Clone from GitHub first (local machine)

Run on your local machine:

```bash
git clone YOUR_GITHUB_REPO_URL watchover
cd watchover
```

If you already have the project locally, skip this and go to 6.2.
### 6.2 Initialize a bare Git repo on Azure server

Run this on the Azure VM SSH terminal (prompt looks like `WatchOver@watchover:~$`), not on Windows PowerShell.

If you are still in local PowerShell, connect first:

```bash
ssh WatchOver@AZURE_PUBLIC_IP
```

If your username is lowercase:

```bash
ssh watchover@AZURE_PUBLIC_IP
```

```bash
sudo mkdir -p /opt/watchover.git /var/www/html
sudo git init --bare /opt/watchover.git
sudo chown -R $USER:$USER /opt/watchover.git /var/www/html
sudo chgrp -R www-data /var/www/html
sudo chmod -R g+rX /var/www/html
sudo find /var/www/html -type d -exec chmod g+s {} \;
```

Create post-receive hook so every push auto-deploys to `/var/www/html`:

```bash
nano /opt/watchover.git/hooks/post-receive
```

Put this script inside:

```bash
#!/usr/bin/env bash
set -e
GIT_WORK_TREE=/var/www/html git --git-dir=/opt/watchover.git checkout -f main
cd /var/www/html
echo "Deploy complete"
```



Then make it executable:

```bash
chmod +x /opt/watchover.git/hooks/post-receive
```

### 6.3 Create database and app user (BEFORE first push)

Run this on the Azure VM SSH terminal BEFORE pushing your code for the first time:

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE watchover CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'watchover_user'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON watchover.* TO 'watchover_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Replace `REPLACE_WITH_STRONG_PASSWORD` with the password you will use.

### 6.4 Push project from local machine to Azure server

Run these on your local machine (project folder):

```bash
git remote add azure WatchOver@AZURE_PUBLIC_IP:/opt/watchover.git
git push azure main
```

If your VM username is lowercase, use `watchover@AZURE_PUBLIC_IP`.

### 6.5 Verify deployed files on Azure server

```bash
ls -la /var/www/html
```

### 6.6 Import database dump

When the file exists at `/var/www/html/watchover_database.sql`, run:

```bash
mysql -u watchover_user -p watchover < /var/www/html/watchover_database.sql
```

### 6.6 Permissions

```bash
sudo chown -R $USER:www-data /var/www/html
sudo find /var/www/html -type d -exec chmod 755 {} \;
sudo find /var/www/html -type f -exec chmod 644 {} \;
sudo chmod 600 /var/www/html/.env
```

If files do not appear after push, run this one-time permission fix then push again:

```bash
sudo chown -R $USER:$USER /var/www/html
GIT_WORK_TREE=/var/www/html git --git-dir=/opt/watchover.git checkout -f main
```

If you previously used `/var/www/watchover`, migrate fully to one webroot:

```bash
sudo rsync -a --delete /var/www/watchover/ /var/www/html/ 2>/dev/null || true
sudo sed -i 's#/var/www/watchover#/var/www/html#g' /etc/apache2/sites-available/watchover.conf
sudo sed -i 's#/var/www/watchover#/var/www/html#g' /opt/watchover.git/hooks/post-receive
for f in /etc/apache2/sites-available/*le-ssl.conf; do sudo sed -i 's#/var/www/watchover#/var/www/html#g' "$f"; done
sudo apache2ctl configtest
sudo systemctl reload apache2
sudo grep -R "/var/www/watchover" /etc/apache2/sites-available /etc/apache2/sites-enabled /opt/watchover.git/hooks/post-receive
```

Only when the final grep has no output, you can remove old folder:

```bash
sudo rm -rf /var/www/watchover
```

---

## 7) Secure phpMyAdmin (Only If Needed)

Recommended: keep phpMyAdmin disabled for public internet access.

### 7.1 Install

```bash
sudo apt install -y phpmyadmin
```

### 7.2 Restrict to localhost only
Edit phpMyAdmin Apache config:

```bash
sudo nano /etc/apache2/conf-available/phpmyadmin.conf
```

If the file is empty, paste this full config:

Alias /phpmyadmin /usr/share/phpmyadmin

<Directory /usr/share/phpmyadmin>
  Options SymLinksIfOwnerMatch
  DirectoryIndex index.php
  Require local
</Directory>

<Directory /usr/share/phpmyadmin/templates>
  Require all denied
</Directory>

<Directory /usr/share/phpmyadmin/libraries>
  Require all denied
</Directory>


Enable config and modules (safe to run even if already enabled):

```bash
sudo a2enconf phpmyadmin
sudo a2enmod rewrite headers
```

Then reload Apache:

```bash
sudo systemctl reload apache2
```

### 7.3 Access via SSH tunnel from your laptop

Important: run this in a local VS Code terminal (PowerShell on your laptop), not inside the SSH terminal connected to Azure VM.

Use two terminals:
- Terminal A: SSH to Azure VM (server commands).
- Terminal B: local PowerShell (tunnel command).

```bash
ssh -N -L 8080:127.0.0.1:80 WatchOver@AZURE_PUBLIC_IP
```

Then browse:
- `http://127.0.0.1:8080/phpmyadmin`

Do not use `https://localhost:8080` for the tunnel endpoint.

Keep Terminal B open while using phpMyAdmin. If you close Terminal B, the tunnel stops.

If you get `connection refused`:

1. On Azure VM (Terminal A), check Apache:

```bash
sudo systemctl status apache2 --no-pager
```

2. On Azure VM, make sure phpMyAdmin config is enabled:

```bash
sudo a2enconf phpmyadmin
sudo systemctl reload apache2
```

3. On local PowerShell (Terminal B), recreate tunnel with verbose output:

```bash
ssh -v -N -L 8080:127.0.0.1:80 WatchOver@AZURE_PUBLIC_IP
```

4. On local PowerShell (another local terminal), test endpoint:

```powershell
Invoke-WebRequest http://127.0.0.1:8080/phpmyadmin -UseBasicParsing
```

If browser shows `ERR_SSL_PROTOCOL_ERROR`, it means `/phpmyadmin` was redirected to HTTPS on port 8080.

Run this on Azure VM (Terminal A):

```bash
sudo nano /etc/apache2/sites-available/watchover.conf
```

Ensure these lines exist above the final redirect rule in `<VirtualHost *:80>`:

RewriteCond %{REQUEST_URI} ^/phpmyadmin(/|$) [NC]
RewriteRule ^ - [L]

And make sure the redirect uses your public domain (not `%{HTTP_HOST}`):

RewriteRule ^ https://your-domain.com%{REQUEST_URI} [R=301,L]

Also remove any duplicate certbot redirect block in this file, such as:

RewriteCond %{SERVER_NAME} =www.your-domain.com [OR]
RewriteCond %{SERVER_NAME} =your-domain.com
RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]


Then validate and reload:

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Reconnect tunnel from local PowerShell and open `http://127.0.0.1:8080/phpmyadmin`.

## 8) No `.htaccess` Mode (Use Apache Vhosts Only)

This setup moves all rewrite/security/cache rules to Apache vhost configs.

1. In both `watchover.conf` and active SSL vhost, keep:

```apache
<Directory /var/www/html>
  AllowOverride None
  Require all granted
</Directory>
```

2. Optional cleanup (disable project `.htaccess` by renaming it):

```bash
mv /var/www/html/.htaccess /var/www/html/.htaccess.disabled
```

3. Validate and reload Apache:

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

4. Verify routing and security:

```bash
curl -I https://your-domain.com/
curl -I https://your-domain.com/.env
curl -I https://your-domain.com/login
```

Expected:
- `/` redirects to login
- `.env` returns 403
- `/login` returns 200

---

## 9) Deployment Workflow (Git Push to Azure)

Each time you deploy new changes from local machine:

```bash
git add .
git commit -m "your update message"
git push azure main
```

The post-receive hook on Azure will automatically:
- checkout files into `/var/www/html`
- run `composer install --no-dev --optimize-autoloader`

After each push, run these on Azure server:

```bash
sudo systemctl reload apache2
```
