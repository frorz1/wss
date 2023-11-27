import express from 'express'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Server } from 'socket.io'

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

  const app = express()
  const server = createServer(app)
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  })

  const __dirname = dirname(fileURLToPath(import.meta.url))

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'))
  })

  io.on('connection', async (socket) => {

    let handshake = socket.handshake;

    socket.broadcast.emit('chat', `user ${handshake.query.user} connected`)
    socket.on('disconnect', () => {
      socket.emit('chat message', `user ${socket.id} offline`)
    })

    socket.on('chat', async (msg) => {
      console.log('msg', msg)
      socket.broadcast.emit('chat', msg);
    })

    socket.on('typing', async (user) => {
      socket.broadcast.emit('typing', user);
    })
  })

  // 根据CPU核数 3000-30xx 端口都可以访问
  const port = process.env.PORT || 3002

  server.listen(port, () => {
    console.log(`wss listen on ${port}`)
  })
}

