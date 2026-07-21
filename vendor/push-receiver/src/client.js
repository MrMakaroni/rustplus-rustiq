const EventEmitter = require('events');
const Long = require('long');
const Parser = require('./parser');
const decrypt = require('./utils/decrypt');
const path = require('path');
const tls = require('tls');
const { checkIn } = require('./gcm');
const {
  kMCSVersion,
  kLoginRequestTag,
  kDataMessageStanzaTag,
  kLoginResponseTag,
} = require('./constants');
const { load } = require('protobufjs');

const HOST = 'mtalk.google.com';
const PORT = 5228;
const MAX_RETRY_TIMEOUT = 15;
const RETRY_STEP_MILLISECONDS = 1000;
const MAX_PERSISTENT_IDS = 5000;

let proto = null;

module.exports = class Client extends EventEmitter {
  static async init() {
    if (proto) {
      return;
    }
    proto = await load(path.resolve(__dirname, 'mcs.proto'));
  }

  constructor(androidId, securityToken, persistentIds, keys, options = {}) {
    super();
    this._androidId = androidId;
    this._securityToken = securityToken;
    this._persistentIds = Array.isArray(persistentIds) ? [...persistentIds] : [];
    this._keys = keys;
    this._parserOptions = options.parser || {};
    this._socketFactory = options.socketFactory || (() => new tls.TLSSocket());
    this._retryStepMilliseconds = options.retryStepMilliseconds ??
      RETRY_STEP_MILLISECONDS;
    this._retryCount = 0;
    this._destroyed = false;
    this._connectGeneration = 0;
    this._onSocketConnect = this._onSocketConnect.bind(this);
    this._onSocketClose = this._onSocketClose.bind(this);
    this._onSocketError = this._onSocketError.bind(this);
    this._onMessage = this._onMessage.bind(this);
    this._onParserError = this._onParserError.bind(this);
  }

  async connect() {
    this._destroyed = false;
    const generation = ++this._connectGeneration;
    this._cleanupConnection();
    const controller = new AbortController();
    this._connectAbortController = controller;

    try {
      await Promise.all([Client.init(), Parser.init()]);
      await this._checkIn(controller.signal);
    } catch (error) {
      if (this._connectAbortController === controller) {
        this._connectAbortController = null;
      }
      controller.abort();
      throw error;
    }
    if (this._destroyed || generation !== this._connectGeneration) {
      return;
    }
    this._connectAbortController = null;
    this._connect();
  }

  destroy() {
    this._destroyed = true;
    this._connectGeneration += 1;
    this._cleanupConnection();
  }

  async _checkIn(signal) {
    return checkIn(
      this._androidId,
      this._securityToken,
      { signal },
    );
  }

  _connect() {
    this._socket = this._socketFactory();
    this._socket.setKeepAlive(true);
    this._socket.on('connect', this._onSocketConnect);
    this._socket.on('close', this._onSocketClose);
    this._socket.on('error', this._onSocketError);
    this._parser = new Parser(this._socket, this._parserOptions);
    this._parser.on('message', this._onMessage);
    this._parser.on('error', this._onParserError);
    this._socket.connect({ host : HOST, port : PORT });
    this._socket.write(this._loginBuffer());
  }

  _cleanupConnection() {
    this._connectAbortController?.abort();
    this._connectAbortController = null;
    clearTimeout(this._retryTimeout);
    this._retryTimeout = null;
    if (this._parser) {
      this._parser.removeListener('message', this._onMessage);
      this._parser.removeListener('error', this._onParserError);
      this._parser.destroy();
      this._parser = null;
    }
    if (this._socket) {
      this._socket.removeListener('connect', this._onSocketConnect);
      this._socket.removeListener('close', this._onSocketClose);
      this._socket.removeListener('error', this._onSocketError);
      this._socket.destroy();
      this._socket = null;
    }
  }

  _loginBuffer() {
    const LoginRequestType = proto.lookupType('mcs_proto.LoginRequest');
    const hexAndroidId = Long.fromString(
      this._androidId
    ).toString(16);
    const loginRequest = {
      adaptiveHeartbeat    : false,
      authService          : 2,
      authToken            : this._securityToken,
      id                   : 'chrome-63.0.3234.0',
      domain               : 'mcs.android.com',
      deviceId             : `android-${hexAndroidId}`,
      networkType          : 1,
      resource             : this._androidId,
      user                 : this._androidId,
      useRmq2              : true,
      setting              : [{ name : 'new_vc', value : '1' }],
      // Id of the last notification received
      clientEvent          : [],
      receivedPersistentId : this._persistentIds,
    };

    const errorMessage = LoginRequestType.verify(loginRequest);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    const buffer = LoginRequestType.encodeDelimited(loginRequest).finish();

    return Buffer.concat([
      Buffer.from([kMCSVersion, kLoginRequestTag]),
      buffer,
    ]);
  }

  _onSocketConnect() {
    this._retryCount = 0;
    this.emit('connect');
  }

  _onSocketClose() {
    this.emit('disconnect');
    this._retry();
  }

  _onSocketError(error) {
    // ignore, the close handler takes care of retry
  }

  _onParserError(error) {
    this._reportError(error);
    this._retry();
  }

  _retry() {
    if (this._destroyed || this._retryTimeout) {
      return;
    }
    this._connectGeneration += 1;
    this._cleanupConnection();
    const timeout = Math.min(
      ++this._retryCount * this._retryStepMilliseconds,
      MAX_RETRY_TIMEOUT * 1000
    );
    this._retryTimeout = setTimeout(() => {
      this._retryTimeout = null;
      this.connect().catch(error => {
        this._reportError(error);
        this._retry();
      });
    }, timeout);
  }

  _reportError(error) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
  }

  _onMessage({ tag, object }) {
    try {
      if (tag === kLoginResponseTag) {
        // Clear persistent ids, as we just sent them to the server while logging
        // in.
        this._persistentIds = [];
      } else if (tag === kDataMessageStanzaTag) {
        this._onDataMessage(object);
      }
    } catch (error) {
      this._onParserError(error);
    }
  }

  _onDataMessage(object) {
    if (object.persistentId && this._persistentIds.includes(object.persistentId)) {
      return;
    }

    const appData = object.appData || {};
    // If crypto keys are not provided, the notification is probably not
    // encrypted, so return the message as-is.
    if(!Object.prototype.hasOwnProperty.call(appData, 'crypto-key')){
        this._rememberPersistentId(object.persistentId);
        this.emit('ON_DATA_RECEIVED', object);
        return;
    }

    let message;
    try {

      // decrypt message
      if (!this._keys) {
        throw new Error('Encryption keys are required for encrypted notifications');
      }
      message = decrypt(object, this._keys);

    } catch (error) {
      switch (true) {
        case error.message.includes(
          'Unsupported state or unable to authenticate data'
        ):
        case error.message.includes('crypto-key is missing'):
        case error.message.includes('salt is missing'):
          // NOTE(ibash) Periodically we're unable to decrypt notifications. In
          // all cases we've been able to receive future notifications using the
          // same keys. So, we silently drop this notification.
          console.warn(
            'Message dropped as it could not be decrypted: ' + error.message
          );
          this._rememberPersistentId(object.persistentId);
          return;
        default: {
          throw error;
        }
      }
    }

    // Maintain persistentIds updated with the very last received value
    this._rememberPersistentId(object.persistentId);
    // Send notification
    this.emit('ON_NOTIFICATION_RECEIVED', {
      notification : message,
      persistentId : object.persistentId,
      object       : object,
    });
  }

  _rememberPersistentId(persistentId) {
    if (!persistentId || this._persistentIds.includes(persistentId)) {
      return;
    }
    this._persistentIds.push(persistentId);
    if (this._persistentIds.length > MAX_PERSISTENT_IDS) {
      this._persistentIds.splice(0, this._persistentIds.length - MAX_PERSISTENT_IDS);
    }
  }
};
