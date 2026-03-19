const crypto = require('crypto');
const EventEmitter = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class TinyWebSocketConnection extends EventEmitter {
  constructor(socket, request) {
    super();
    this.socket = socket;
    this.request = request;
    this.buffer = Buffer.alloc(0);
    this.closed = false;

    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('close', () => this.handleClose());
    socket.on('end', () => this.handleClose());
    socket.on('error', (error) => this.emit('error', error));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let offset = 2;
      let length = second & 0x7f;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        length = Number((BigInt(high) << 32n) | BigInt(low));
        offset += 8;
      }

      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;

      let mask = null;
      if (masked) {
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked && mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i += 1) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }
      this.buffer = this.buffer.subarray(offset + length);

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
        continue;
      }
      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      }
    }
  }

  sendFrame(opcode, payload) {
    if (this.closed) return;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
    let header = null;
    if (body.length < 126) {
      header = Buffer.from([0x80 | opcode, body.length]);
    } else if (body.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      const length = BigInt(body.length);
      header.writeUInt32BE(Number(length >> 32n), 2);
      header.writeUInt32BE(Number(length & 0xffffffffn), 6);
    }
    this.socket.write(Buffer.concat([header, body]));
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(String(text), 'utf8'));
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  close() {
    if (this.closed) return;
    this.sendFrame(0x8, Buffer.alloc(0));
    this.socket.end();
    this.handleClose();
  }
}

function attachTinyWebSocketServer(server, handlers) {
  server.on('upgrade', (request, socket) => {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    const handler = handlers[pathname];
    if (!handler) {
      socket.destroy();
      return;
    }
    const key = request.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
    );
    handler(new TinyWebSocketConnection(socket, request), request);
  });
}

module.exports = {
  attachTinyWebSocketServer,
  TinyWebSocketConnection
};
