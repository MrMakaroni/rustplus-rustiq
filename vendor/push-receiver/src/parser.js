const EventEmitter = require('events');
const path = require('path');
const { load } = require('protobufjs');
const {
  MCS_VERSION_TAG_AND_SIZE,
  MCS_TAG_AND_SIZE,
  MCS_SIZE,
  MCS_PROTO_BYTES,
  kMCSVersion,
  kHeartbeatPingTag,
  kHeartbeatAckTag,
  kLoginRequestTag,
  kLoginResponseTag,
  kCloseTag,
  kIqStanzaTag,
  kDataMessageStanzaTag,
  kStreamErrorStanzaTag,
  kSizePacketLenMax,
} = require('./constants');

const DEBUG = () => {};
const MAX_MESSAGE_SIZE = 4 * 1024 * 1024;
const DEFAULT_PARTIAL_FRAME_TIMEOUT_MS = 30000;

let proto = null;

// Incrementally parses the MCS framing protocol without recursively draining
// buffered messages. Partial frames are bounded by both size and time.
module.exports = class Parser extends EventEmitter {
  static async init() {
    if (!proto) {
      proto = await load(path.resolve(__dirname, 'mcs.proto'));
    }
  }

  constructor(socket, options = {}) {
    super();
    this._socket = socket;
    this._partialFrameTimeoutMs = options.partialFrameTimeoutMs ??
      DEFAULT_PARTIAL_FRAME_TIMEOUT_MS;
    this._state = MCS_VERSION_TAG_AND_SIZE;
    this._data = Buffer.alloc(0);
    this._messageTag = 0;
    this._messageSize = 0;
    this._handshakeComplete = false;
    this._destroyed = false;
    this._partialFrameStartedAt = null;
    this._onData = this._onData.bind(this);
    this._socket.on('data', this._onData);
    this._armPartialFrameTimeout();
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    clearTimeout(this._partialFrameTimeout);
    this._partialFrameTimeout = null;
    this._partialFrameStartedAt = null;
    this._data = Buffer.alloc(0);
    this._socket.removeListener('data', this._onData);
  }

  _emitError(error) {
    if (this._destroyed) {
      return;
    }
    this.destroy();
    this.emit('error', error);
  }

  _onData(buffer) {
    if (this._destroyed) {
      return;
    }
    if (!Buffer.isBuffer(buffer)) {
      this._emitError(new TypeError('MCS socket data must be a Buffer'));
      return;
    }

    DEBUG(`Got data: ${buffer.length}`);
    this._data = this._data.length === 0
      ? buffer
      : Buffer.concat([this._data, buffer]);
    this._drain();
  }

  _drain() {
    clearTimeout(this._partialFrameTimeout);
    this._partialFrameTimeout = null;

    while (!this._destroyed) {
      const progressed = this._processNextStep();
      if (!progressed) {
        this._armPartialFrameTimeout();
        return;
      }
    }
  }

  _processNextStep() {
    switch (this._state) {
      case MCS_VERSION_TAG_AND_SIZE:
        return this._readVersionAndTag();
      case MCS_TAG_AND_SIZE:
        return this._readTag();
      case MCS_SIZE:
        return this._readSize();
      case MCS_PROTO_BYTES:
        return this._readMessage();
      default:
        this._emitError(new Error(`Unexpected state: ${this._state}`));
        return false;
    }
  }

  _readVersionAndTag() {
    if (this._data.length < 2) {
      return false;
    }

    const version = this._data.readUInt8(0);
    if (version < kMCSVersion && version !== 38) {
      this._emitError(new Error(`Got wrong version: ${version}`));
      return false;
    }

    this._messageTag = this._data.readUInt8(1);
    this._data = this._data.subarray(2);
    this._state = MCS_SIZE;
    return true;
  }

  _readTag() {
    if (this._data.length < 1) {
      return false;
    }

    this._messageTag = this._data.readUInt8(0);
    this._data = this._data.subarray(1);
    this._state = MCS_SIZE;
    return true;
  }

  _readSize() {
    let size = 0;

    for (let index = 0; index < this._data.length && index < kSizePacketLenMax; index += 1) {
      const byte = this._data[index];
      if (index === kSizePacketLenMax - 1 && (byte & 0xf0) !== 0) {
        this._emitError(new Error('Invalid MCS protobuf size varint'));
        return false;
      }

      size += (byte & 0x7f) * (2 ** (7 * index));
      if ((byte & 0x80) === 0) {
        this._data = this._data.subarray(index + 1);
        if (size > MAX_MESSAGE_SIZE) {
          this._emitError(new Error(
            `Protobuf payload exceeds ${MAX_MESSAGE_SIZE} byte limit`
          ));
          return false;
        }
        this._messageSize = size;
        this._state = MCS_PROTO_BYTES;
        return true;
      }
    }

    if (this._data.length >= kSizePacketLenMax) {
      this._emitError(new Error('Invalid MCS protobuf size varint'));
    }
    return false;
  }

  _readMessage() {
    if (this._data.length < this._messageSize) {
      return false;
    }

    const protobufType = this._buildProtobufFromTag(this._messageTag);
    if (!protobufType) {
      this._emitError(new Error(`Unknown MCS tag: ${this._messageTag}`));
      return false;
    }

    const buffer = this._data.subarray(0, this._messageSize);
    this._data = this._data.subarray(this._messageSize);

    let object = {};
    if (this._messageSize > 0) {
      try {
        const message = protobufType.decode(buffer);
        object = protobufType.toObject(message, {
          longs: String,
          enums: String,
          bytes: Buffer,
        });
      } catch (error) {
        this._emitError(error);
        return false;
      }
    }

    const tag = this._messageTag;
    this._messageTag = 0;
    this._messageSize = 0;
    this._state = MCS_TAG_AND_SIZE;
    this._partialFrameStartedAt = null;
    this.emit('message', { tag, object });

    if (this._destroyed) {
      return false;
    }
    if (tag === kLoginResponseTag) {
      if (this._handshakeComplete) {
        console.error('Unexpected login response');
      } else {
        this._handshakeComplete = true;
        DEBUG('GCM Handshake complete.');
      }
    }
    return true;
  }

  _armPartialFrameTimeout() {
    clearTimeout(this._partialFrameTimeout);
    this._partialFrameTimeout = null;

    const frameInProgress = this._state !== MCS_TAG_AND_SIZE || this._data.length > 0;
    if (this._destroyed || !frameInProgress || this._partialFrameTimeoutMs <= 0) {
      if (!frameInProgress) {
        this._partialFrameStartedAt = null;
      }
      return;
    }

    this._partialFrameStartedAt ??= Date.now();
    const elapsed = Date.now() - this._partialFrameStartedAt;
    const remaining = Math.max(0, this._partialFrameTimeoutMs - elapsed);
    this._partialFrameTimeout = setTimeout(() => {
      this._emitError(new Error('Timed out waiting for the rest of an MCS frame'));
    }, remaining);
    this._partialFrameTimeout.unref?.();
  }

  _buildProtobufFromTag(tag) {
    switch (tag) {
      case kHeartbeatPingTag:
        return proto.lookupType('mcs_proto.HeartbeatPing');
      case kHeartbeatAckTag:
        return proto.lookupType('mcs_proto.HeartbeatAck');
      case kLoginRequestTag:
        return proto.lookupType('mcs_proto.LoginRequest');
      case kLoginResponseTag:
        return proto.lookupType('mcs_proto.LoginResponse');
      case kCloseTag:
        return proto.lookupType('mcs_proto.Close');
      case kIqStanzaTag:
        return proto.lookupType('mcs_proto.IqStanza');
      case kDataMessageStanzaTag:
        return proto.lookupType('mcs_proto.DataMessageStanza');
      case kStreamErrorStanzaTag:
        return proto.lookupType('mcs_proto.StreamErrorStanza');
      default:
        return null;
    }
  }
};
