# 专注伴伴 ⏰

计时陪伴 PWA — 设置任务，开始专注，AI 陪你完成每一次专注。

## 功能

- ✅ 自定义时长正计时/倒计时
- ✅ 横屏全屏专注界面
- ✅ AI 鼓励气泡（DeepSeek 驱动）
- ✅ 完成提醒通知
- ✅ 专注记录保存 + 周记/月报统计
- ✅ PWA 离线可用，可安装到手机

## 开发

```bash
# 本地运行（任意静态服务器）
npx serve .
# 或 VS Code Live Server
```

## 部署到 GitHub Pages

1. 创建 GitHub 仓库（设为 Private）
2. 将本文件夹推送到仓库
3. 在 Settings > Pages 选择 main 分支，根目录
4. 访问 `https://<你的用户名>.github.io/<仓库名>`

> ⚠️ `js/config.js` 包含 API Key，已被 `.gitignore` 忽略。
> 部署后 AI 功能会使用本地备用消息（无需 Key 也能用）。
> 如需完整 AI 功能，部署后手动将 `js/config.js` 上传到仓库即可。

## API Key

默认使用 DeepSeek API，Key 在 `js/config.js` 中配置。
如需更换其他模型，修改 `js/config.js` 中的 endpoint 和 model 即可。
