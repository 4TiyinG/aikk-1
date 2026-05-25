const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = 'sk-7LRggVLwgm5A7aai7tJPllYtd6lXrTY4PSfqF6feGd0YCELP';

app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 流式代理：直接透传上游 SSE 数据
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

    // 关键：直接透传流，不再手动解析写入
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');   // 禁用 nginx 缓冲
    res.flushHeaders();

    // 将上游 ReadableStream 直接 pipe 到响应
    const reader = response.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          // 直接写入缓冲区，无需额外处理
          res.write(value);
        }
      } catch (err) {
        console.error('流式传输中断:', err);
        if (!res.writableEnded) {
          res.status(500).end();
        }
      }
    };
    pump();

  } catch (err) {
    console.error('API 请求失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 聊天服务器已启动: http://localhost:${PORT}`);
});
