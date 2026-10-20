// Local MQTT-over-WebSocket broker for tests:  npm i aedes ws   then   node test/broker.js 9001
// Open the game with  ?broker=ws://127.0.0.1:9001
const { Aedes } = require('aedes');
const http = require('http');
const { WebSocketServer, createWebSocketStream } = require('ws');
(async () => {
  const aedes = await Aedes.createBroker();
  const server = http.createServer();
  const wss = new WebSocketServer({ server, handleProtocols: p => (p.has ? (p.has('mqtt') ? 'mqtt' : false) : 'mqtt') });
  wss.on('connection', sock => aedes.handle(createWebSocketStream(sock)));
  server.listen(+process.argv[2] || 9001, '0.0.0.0', () => console.log('broker up'));
})();
