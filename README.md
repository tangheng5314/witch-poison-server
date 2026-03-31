# 女巫的毒药 - Railway 部署指南

## 部署步骤

### 1. 创建 Railway 账户
1. 访问 [railway.app](https://railway.app)
2. 使用 GitHub 登录

### 2. 部署服务器
1. 在 Railway 控制台点击 "New Project"
2. 选择 "Deploy from GitHub repo"
3. 连接你的 GitHub 账户
4. 选择 `witch-poison-server` 仓库
5. Railway 会自动检测 Node.js 项目并部署

### 3. 获取服务器地址
部署完成后，在项目设置中找到生成的 URL，例如：
```
https://witch-poison-server.up.railway.app
```

### 4. 更新前端配置
将 `witch-poison-h5/js/config.js` 中的 `WS_URL` 改为：
```javascript
WS_URL: 'wss://witch-poison-server.up.railway.app'
```

### 5. 部署前端 H5
1. 将修改后的前端代码部署到 Vercel、Netlify 或其他静态托管服务

## 本地测试

```bash
cd witch-poison-server
npm install
npm start
```

服务器会在 `http://localhost:3000` 启动。

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务器端口 | 3000 |

## WebSocket 连接

前端通过 WebSocket 连接服务器：
- 连接地址：`wss://your-railway-url.railway.app`
- 心跳保持：服务器会自动处理断线重连
