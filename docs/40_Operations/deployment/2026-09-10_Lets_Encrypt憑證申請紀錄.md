# Let's Encrypt 正式憑證申請紀錄（2026-09-10）

## 結論

`https://focusflow.ntub.edu.tw` 已改用 **Let's Encrypt 正式憑證**，瀏覽器不再顯示「不安全」。

| 項目 | 內容 |
|------|------|
| 簽發 CA | `C=US, O=Let's Encrypt, CN=YE2`（正式環境，非 STAGING） |
| 憑證主體 | `CN=focusflow.ntub.edu.tw` |
| 效期 | 2026-09-10 13:49 GMT ～ **2026-12-09 13:49 GMT**（90 天） |
| 驗證方式 | TLS-ALPN-01（全程走 port 443，不需要 port 80） |
| 工具 | acme.sh（安裝於 `/opt/acme.sh`，以 root 執行） |
| 帳號信箱 | `11246084@ntub.edu.tw` |
| nginx 使用路徑 | `/etc/nginx/ssl/focusflow.crt`（full chain）、`/etc/nginx/ssl/focusflow.key` |
| 自動續約 | acme.sh 每日 cron；ARI 排定下次續約約 **2026-11-10** |

前一份排查紀錄（port 80／443 實測、nginx 轉址設定、tcpdump 證據）在本機 `context/2026_08_12_對外連線開通與HTTPS憑證排查.md`，`context/` 不進版控；本文件已收錄接手續約與回滾所需的全部資訊。

---

## 1. 為什麼走 acme.sh + TLS-ALPN-01

Let's Encrypt 核發前要確認申請者擁有網域，有三種驗證方式：

| 驗證方式 | 需要條件 | 本專案 |
|---|---|---|
| HTTP-01 | 外部連得進 port 80 | ❌ 學校不開放 port 80（技士已明確表示不會開） |
| DNS-01 | 在網域加 TXT 記錄 | ⚠️ DNS 由學校管理、無 API，手動模式每 60 天要再找技士 |
| TLS-ALPN-01 | 外部連得進 port 443 | ✅ 443 全球可達（2026-08-12 check-host 全節點 Connected） |

- **certbot 無法使用**：它沒有實作 TLS-ALPN-01（2026-08-12 實測回 `None of the preferred challenges are supported by the selected plugin`），只能走 HTTP-01，而 port 80 不通。
- **自簽憑證無法解決警告**：原本網站用的就是自簽憑證，瀏覽器只信任公開 CA 簽發的憑證。
- 2026-08-23 曾以 acme.sh `--staging` 試簽成功，但當時預期 port 80 會開通、打算改用 certbot，因此先移除 acme.sh。2026-09-10 確認 port 80 不會開放後，重新安裝 acme.sh 正式簽發。

### 取捨

- acme.sh 是第三方開源腳本（非 EPEL 官方套件），以 root 身分執行並常駐 cron。在「port 80 永遠不開」的前提下，這是能取得受信任憑證且自動續約的唯一不需他人配合的方式。
- 簽發與每次續約時，acme.sh 需要自己佔用 443，所以會**停止 nginx 約 30 秒**（由 hooks 自動停啟）。

---

## 2. 執行步驟（實際執行紀錄）

以下在 VM（`rocky101702`）上執行。`git`、`socat` 在 2026-08-23 已安裝。

### 2-1 取得並安裝 acme.sh

```bash
# 以 case 身分執行
git clone https://github.com/acmesh-official/acme.sh.git ~/acme.sh-src

# 安裝程式從「當前目錄」複製檔案，必須先 cd 進去
cd ~/acme.sh-src && sudo ./acme.sh --install --home /opt/acme.sh -m 11246084@ntub.edu.tw
# → Installed to /opt/acme.sh/acme.sh
# → Installing cron job
# → OK
```

### 2-2 切換 root shell 並指定 CA

acme.sh 拒絕以 `sudo` 從一般使用者執行（會報 `It seems that you are using sudo`），必須切 root 登入 shell，**之後的指令都不加 sudo**：

```bash
sudo -i

# acme.sh 預設 CA 是 ZeroSSL，需明確改為 Let's Encrypt
/opt/acme.sh/acme.sh --set-default-ca --server letsencrypt
# → Changed default CA to: https://acme-v02.api.letsencrypt.org/directory
```

### 2-3 正式簽發（nginx 停約 30 秒）

2026-08-23 已用 staging 驗證過流程且當時資料已刪除，所以這次直接正式簽發，不需 `--staging` 或 `--force`：

```bash
/opt/acme.sh/acme.sh --issue --alpn -d focusflow.ntub.edu.tw \
  --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
# → Your cert is in: /opt/acme.sh/focusflow.ntub.edu.tw_ecc/focusflow.ntub.edu.tw.cer
# → And the full-chain cert is in: /opt/acme.sh/focusflow.ntub.edu.tw_ecc/fullchain.cer
# → Next renewal time picked from ARI window: 2026-11-10T05:30:53Z
# → Running post hook:'systemctl start nginx'
```

確認是正式憑證（不是 STAGING）：

```bash
openssl x509 -in /opt/acme.sh/focusflow.ntub.edu.tw_ecc/focusflow.ntub.edu.tw.cer -noout -issuer -dates
# issuer=C=US, O=Let's Encrypt, CN=YE2
# notBefore=Sep 10 13:49:08 2026 GMT
# notAfter=Dec  9 13:49:07 2026 GMT
```

### 2-4 安裝到 nginx 固定路徑

憑證為 ECC，需加 `--ecc`。設定 `--reloadcmd` 後，之後每次續約都會自動覆蓋這兩個檔案並 reload nginx：

```bash
/opt/acme.sh/acme.sh --install-cert -d focusflow.ntub.edu.tw --ecc \
  --key-file /etc/nginx/ssl/focusflow.key \
  --fullchain-file /etc/nginx/ssl/focusflow.crt \
  --reloadcmd "systemctl reload nginx"
# → Installing key to: /etc/nginx/ssl/focusflow.key
# → Installing full chain to: /etc/nginx/ssl/focusflow.crt
# → Reload successful
```

### 2-5 nginx 改用新憑證

```bash
sed -i 's|/etc/nginx/ssl/selfsigned.crt|/etc/nginx/ssl/focusflow.crt|; s|/etc/nginx/ssl/selfsigned.key|/etc/nginx/ssl/focusflow.key|' /etc/nginx/conf.d/focusflow.conf

nginx -t && systemctl reload nginx
# → syntax is ok / test is successful
```

---

## 3. 驗證結果

### 伺服器實際送出的憑證

```bash
echo | openssl s_client -connect focusflow.ntub.edu.tw:443 -servername focusflow.ntub.edu.tw 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
# issuer=C=US, O=Let's Encrypt, CN=YE2
# subject=CN=focusflow.ntub.edu.tw
# notBefore=Sep 10 13:49:08 2026 GMT
# notAfter=Dec  9 13:49:07 2026 GMT
```

換憑證前同一條指令的結果是 `issuer=CN=focusflow.ntub.edu.tw`（自簽，效期至 2027-08-04）。

### 用戶端信任驗證（Windows，不加 `-k`）

```powershell
curl.exe -v --max-time 10 https://focusflow.ntub.edu.tw/
# → HTTP/1.1 200 OK
```

換憑證前同一條指令回 `SEC_E_UNTRUSTED_ROOT` / `curl: (60)`，現在直接 200，代表 Windows 已信任此憑證。

注意：這次測試的來源 IP 是 `10.212.134.205`（學校 VPN）。憑證是否受信任與連線路徑無關；且 Let's Encrypt 簽發時就是從國外連入 443 驗證，校外可達性已獲證明。

### 自動續約設定

使用者回報以下兩項檢查皆已確認存在（未貼出完整輸出）：

```bash
crontab -l | grep acme
# 應有 /opt/acme.sh/acme.sh --cron 的每日排程

grep -E "Le_PreHook|Le_PostHook|Le_ReloadCmd|Le_RealKeyPath|Le_RealFullChainPath|Le_NextRenewTimeStr" \
  /opt/acme.sh/focusflow.ntub.edu.tw_ecc/focusflow.ntub.edu.tw.conf
# 六項皆應有值（hook 可能是 base64 編碼）
```

未執行強制續約測試：強制續約會真的再簽一張、網站再停 30 秒，並用掉簽發額度。

---

## 4. 自動續約怎麼運作

1. root 的 crontab 每天執行一次 `acme.sh --cron`，未到期前不做任何事
2. 到了續約時間（ARI 目前排定約 2026-11-10），執行 pre-hook `systemctl stop nginx`
3. acme.sh 自己佔用 443 完成 TLS-ALPN-01 驗證並取得新憑證
4. 執行 post-hook `systemctl start nginx`
5. 依 `--install-cert` 設定覆蓋 `/etc/nginx/ssl/focusflow.crt` / `.key`，再執行 `systemctl reload nginx`

整個過程網站會中斷約 30 秒，不需人工介入。

### 續約會失敗的情況

- **學校收回 port 443 的對外開放**，或對 443 加上來源／地區限制 → Let's Encrypt 驗證伺服器（美國、歐洲）連不進來
- 續約時有其他程式佔用 443（正常情況只有 nginx，且會被 pre-hook 停掉）
- `/opt/acme.sh` 被刪除，或 root crontab 被清除

失敗時 acme.sh 會在之後每天的 cron 重試，但**不會主動通知**（Let's Encrypt 已於 2025 年停止寄送到期提醒信）。建議在 **2026-11-15 前**確認一次是否已續約：

```bash
echo | openssl s_client -connect focusflow.ntub.edu.tw:443 -servername focusflow.ntub.edu.tw 2>/dev/null \
  | openssl x509 -noout -dates
# notAfter 應已延後到 2027 年 2 月左右
```

若未續約，可手動觸發並觀察錯誤訊息：

```bash
sudo -i
/opt/acme.sh/acme.sh --renew -d focusflow.ntub.edu.tw --ecc
```

---

## 5. 回滾方式

自簽憑證 `/etc/nginx/ssl/selfsigned.crt` / `selfsigned.key` 仍保留在 VM 上（效期至 2027-08-04）。若新憑證出問題，改回自簽：

```bash
sudo sed -i 's|/etc/nginx/ssl/focusflow.crt|/etc/nginx/ssl/selfsigned.crt|; s|/etc/nginx/ssl/focusflow.key|/etc/nginx/ssl/selfsigned.key|' /etc/nginx/conf.d/focusflow.conf
sudo nginx -t && sudo systemctl reload nginx
```

注意：回滾後 acme.sh 的 cron 仍會在續約時覆蓋 `focusflow.crt` 並 reload nginx，但因 nginx 已不指向該檔案，不影響網站。若要完全停用 acme.sh：

```bash
sudo -i
/opt/acme.sh/acme.sh --uninstall
rm -rf /opt/acme.sh
rm -rf /home/case/acme.sh-src   # root shell 裡的 ~ 指向 /root，不能用 ~/acme.sh-src
```

---

## 6. 這次踩到的坑

| 現象 | 原因 | 解法 |
|---|---|---|
| `cd: /home/case/acme.sh-src: 沒有此一檔案或目錄` | 2026-08-23 移除 acme.sh 時已刪除原始碼 | 重新 `git clone` |
| `cp: 無法取得 'acme.sh' 的資訊` / `Installation failed`（08-23） | 安裝程式從當前目錄複製檔案 | 先 `cd ~/acme.sh-src` 再執行 |
| `It seems that you are using sudo` | acme.sh 不接受 sudo 執行（`$HOME` 不一致會存錯設定目錄） | 先 `sudo -i`，之後不加 sudo |
| Windows 上 `findstr: 找不到指令` | 把 Windows 指令貼到 VM 的 bash | VM 上改用 `openssl s_client` 檢查 |
| PowerShell `curl -v --max-time 10` 報參數錯誤 | PowerShell 5.1 的 `curl` 是 `Invoke-WebRequest` 別名 | 改用 `curl.exe` |

---

## 7. 相關殘留與後續

- **certbot 仍安裝在 VM 上但未使用**：2026-08-12 曾以 certbot 註冊 Let's Encrypt 帳號（信箱為當時的個人信箱，存於 `/etc/letsencrypt/`）。`certbot-renew.timer` 未啟用，不會自動執行。若確定不再使用，可 `sudo dnf remove certbot` 並刪除 `/etc/letsencrypt/`。
- **port 80 仍對外不通**：nginx 已設定 80 → 301 轉 HTTPS，但封包到不了 VM。瀏覽器直接輸入網址會自動改用 HTTPS 所以沒問題；明確寫 `http://` 的連結、程式呼叫或部分 App 內建瀏覽器仍會連不上。對外一律提供 `https://` 開頭的網址。
- **LINE webhook 仍使用 ngrok**：現在有受信任憑證，技術上可以把 LINE Developers 的 webhook URL 改成 `https://focusflow.ntub.edu.tw/api/v1/line/webhook` 並停用 `ngrok.service`。尚未執行，改之前需確認實際 webhook 路徑並做一次 live 測試。
- **HSTS 可以考慮加了**：之前因為是自簽憑證不能加。但要注意，加了之後若憑證續約失敗，使用者會完全無法繞過警告進站；建議等確認過一次自動續約成功後再加。
- **`ALLOWED_ORIGINS` 仍未設定**：CORS 仍是開發期全開，正式對外前應收斂。

---

## 8. 不能誤稱的邊界

- **不能說「port 80 已開通」或「HTTP 會自動轉址」**：80 對外仍不通，轉址設定只在 VM 內部驗證過
- **不能說「自動續約已驗證成功」**：cron 與續約設定已確認存在，但尚未實際經歷一次續約（第一次預計在 2026-11-10 前後）
- **用 IP 存取仍會跳警告**：`https://140.131.115.105/` 不在憑證範圍內，公開 CA 不為 IP 簽發憑證
- **憑證受信任 ≠ 系統已正式上線**：學生試用版驗收證據、CORS 收斂、LINE 改走正式網域等仍未完成
- 本次未修改 repo 內任何程式碼；nginx 設定、憑證與 acme.sh 皆為 VM 上手動維護、不進版控的項目
