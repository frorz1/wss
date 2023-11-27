import express from 'express'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Server } from 'socket.io'
import sqlite from 'sqlite3'
import { open } from 'sqlite'

// 开启多集群模式
import { availableParallelism } from 'node:os'
import cluster from 'node:cluster'
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter'

if (cluster.isPrimary) {
  // 如果是主线程
  const numCPUs = availableParallelism()
  for (let i = 0; i < numCPUs; i++) {
    // 创建多线程
    cluster.fork({
      PORT: 3000 + i
    })
  }
  // 启动主线程
  setupPrimary()
} else {
  // 如果是子线程
  // 打开数据库
  const db = await open({
    filename: 'chat.db',
    driver: sqlite.Database
  })

  // 创建chat table
  const table = db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
  `)

  const app = express()
  const server = createServer(app)
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  })

  const __dirname = dirname(fileURLToPath(import.meta.url))

  app.get('/', (req, res) => {
    res.send('<h1>hello world</h1>')
  })

  app.get('/home', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'))
  })

  io.on('connection', async (socket) => {
    // socket就是一个连接里专属的实例，其他操作都要在这上面进行，而不是io
    io.emit('chat message', `user ${socket.id} online`)
    // 关闭当前这个用户的实例连接
    socket.on('disconnect', () => {
      io.emit('chat message', `user ${socket.id} offline`)
    })

    socket.on('chat message', async (msg, clientOffset, ack) => {
      console.log('msg', msg)
      let result
      try {
        result = await db.run(`INSERT INTO messages (content, client_offset) VALUES (?, ?)`, msg, clientOffset)
      } catch (error) {
        if (error.errno === 19 /* SQLITE_CONSTRAINT */ ) {
          // the message was already inserted, so we notify the client
          ack();
        } else {
          // nothing to do, just let the client retry
        }
        return;
      }
      console.log('result', result)
      io.emit('chat message', msg, result.lastID);
      // 如果消息发送成功，要通知客户端，不然会一直重试
      ack()
    })
    if (!socket.recovered) {
      try {
        await db.each(`SELECT id, content FROM messages WHERE id > ?`,
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            console.log('row', row)
            socket.emit('chat message', row.content, row.id);
          }
        )
      } catch (error) {
        
      }
    }
  })

  // 根据CPU核数 3000-30xx 端口都可以访问

  const port = process.env.PORT || 3002

  server.listen(port, () => {
    console.log(`wss listen on ${port}`)
  })
}

