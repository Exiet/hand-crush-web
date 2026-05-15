# Hand Crush Web 部署说明

目标：让 **手机用户直接点一个网络地址就能玩**。

## 核心要求

要让手机浏览器正常使用相机，必须满足：

1. **使用 HTTPS 地址**
2. **浏览器允许相机权限**

因为 `getUserMedia` 在大多数手机浏览器里只允许在：
- `https://...`
- `localhost`

环境下使用。

---

## 推荐部署平台

### 1. Cloudflare Pages（推荐）

优点：
- 免费
- 自动 HTTPS
- 全球访问快
- 很适合这种纯前端静态项目

配置：
- Build command: `npm run build`
- Output directory: `dist`

部署完成后得到类似：

```text
https://your-project.pages.dev
```

这个地址可以直接发给手机用户。

### 2. Netlify

配置：
- Build command: `npm run build`
- Publish directory: `dist`

部署后得到：

```text
https://your-project.netlify.app
```

### 3. Vercel

配置：
- Framework Preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`

部署后得到：

```text
https://your-project.vercel.app
```

---

## 最推荐流程（GitHub + Cloudflare Pages）

### 第一步：把项目推到 GitHub

```bash
git init
git add .
git commit -m "feat: init hand crush web"
```

然后创建 GitHub 仓库并推送。

### 第二步：连接 Cloudflare Pages

1. 登录 Cloudflare Dashboard
2. 进入 **Workers & Pages**
3. 选择 **Create application**
4. 选择 **Pages**
5. 连接 GitHub 仓库
6. 填入构建信息：
   - Build command: `npm run build`
   - Build output directory: `dist`
7. 点击部署

### 第三步：拿到 HTTPS 地址并分享

部署完成后会得到一个公网 HTTPS 地址，直接发给别人即可试玩。

---

## 本地预览构建结果

```bash
npm run build
npm run preview -- --host
```

适合你自己先验收，但这不是正式上线地址。

---

## 分享前检查清单

- [ ] 页面可以正常打开
- [ ] 使用的是 HTTPS 链接
- [ ] 点击开始后会请求相机权限
- [ ] Android Chrome 可以稳定识别握拳
- [ ] iPhone Safari 可以正常启动
- [ ] 权限拒绝时有清晰提示
- [ ] 首次加载速度可接受

---

## iPhone / Android 使用建议

### iPhone
- 优先用 Safari
- 必须是 HTTPS
- 振动反馈可能受限
- 可通过“添加到主屏幕”获得更接近 App 的体验

### Android
- 推荐 Chrome
- HTTPS 下相机 / 振动 / PWA 体验通常更完整

---

## 当前项目部署所需命令

```bash
npm install
npm run build
```

产物目录：

```bash
dist/
```

只要平台支持静态文件托管，就能部署这个目录。
