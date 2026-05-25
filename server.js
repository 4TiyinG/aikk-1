// server.js - 本地 Express 代理 (修复流式输出与断点续传)
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 上游 API 配置
const API_URL = 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = 'sk-7LRggVLwgm5A7aai7tJPllYtd6lXrTY4PSfqF6feGd0YCELP';

// 中间件
app.use(express.static(__dirname));
app.use(express.json());

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 聊天 API 代理 (SSE)
app.post('/api/chat', async (req, res) => {
  const { model, messages, temperature = 0.7, max_tokens = 8192 } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: '缺少必要参数' });
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

    // 设置 SSE 响应头，并禁用缓冲
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 强制禁用 Nagle 算法，确保小块数据立即发送
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // 处理可能残留的 buffer
          if (buffer.trim()) {
            res.write(buffer.trim() + '\n');
          }
          res.write('data: [DONE]\n\n');
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            res.write(line.trim() + '\n');
          }
        }
      }
    } catch (streamErr) {
      console.error('流式传输中断:', streamErr);
    }
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

app.listen(PORT, () => {
  console.log(`🚀 服务已启动: http://localhost:${PORT}`);
});