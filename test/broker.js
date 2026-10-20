// Local PeerJS broker for tests:  npm i peer   then   node test/broker.js 9000
const { PeerServer } = require('peer');
PeerServer({ port: +process.argv[2] || 9000, path: '/', host: '0.0.0.0' });
console.log('broker up');
