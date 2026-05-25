// server.js - 本地开发 Express 服务器
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// API 配置
const API_URL = 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = 'sk-7LRggVLwgm5A7aai7tJPllYtd6lXrTY4PSfqF6feGd0YCELP';

// 中间件
app.use(express.static(__dirname));
app.use(express.json());

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 聊天 API 代理（流式转发）
app.post('/api/chat', async (req, res) => {
  const { model, messages, temperature = 0.7, max_tokens = 8192 } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: '缺少必要参数 model 或 messages' });
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `上游 API 错误: ${errText}` });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 流式转发
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            res.write(line + '\n');
          }
        }
      }
      if (buffer.trim()) {
        res.write(buffer + '\n');
      }
    } catch (streamErr) {
      console.error('流式传输中断:', streamErr);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('API 请求失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `请求失败: ${err.message}` });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`🚀 聊天服务器已启动: http://localhost:${PORT}`);
  console.log(`📡 API 代理端点: http://localhost:${PORT}/api/chat`);
  console.log(`💡 提示: 使用 'edgeone pages dev' 在本地调试 Cloud Functions`);
});
