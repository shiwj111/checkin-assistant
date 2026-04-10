# 🕐 打卡助手 - Cloudflare 部署指南（完全免费）
**不用服务器、不用 Mac、完全免费**
---
## 最终效果
- 🌐 打开一个网页（PWA）添加到手机桌面
- 📍 打开后每 30 秒自动上传位置到 Cloudflare
- ⏰ 到了指定时间（9:30 / 19:00），Cloudflare 自动检测并**发飞书消息**给你
- 📱 完全不需要你唤醒，手机放那就行
---
## 需要准备的东西
1. ✅ 一个 **GitHub 账号**（免费）
2. ✅ 一个 **Cloudflare 账号**（免费）
3. ✅ 一个 **飞书群或单聊**（添加自定义机器人）
---
## 第一步：上传代码到 GitHub
（如果代码已在 GitHub，跳过此步）
---
## 第二步：部署 Cloudflare Worker（后端）
### 2.1 创建 KV 命名空间
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧 **Workers & Pages**
3. 点击 **管理 KV 命名空间** → **创建命名空间**
4. 名字填 `checkin_records`，点击创建
5. 创建完成后，复制 **ID**
### 2.2 部署 Worker
1. Cloudflare Dashboard → Workers & Pages → **创建 Worker**
2. 名字填 `checkin-worker`，点击 **部署**
3. 点击 Worker → **设置** → **变量**：
   - 点击 **KV 命名空间** → **编辑变量**
   - 变量名填 `CHECKIN_RECORDS`
   - 选择你刚才创建的命名空间
   - 点击 **保存**
4. 点击 **触发器** → **Cron 触发器**：
   - Cron 表达式填入：
     ```
<br>
     0 9 * * 1-5, 30 9 * * 1-5, 45 9 * * 1-5, 0 10 * * 1-5, 0 19 * * 1-5, 30 19 * * 1-5, 0 20 * * 1-5, 30 20 * * 1-5
     
<br>
