const register = require('./register');
const Client = require('./client.js');
const AndroidFCM = require('./android/fcm.js');

module.exports = {
  listen,
  register,
  AndroidFCM,
  Client,
};

async function listen(credentialsOrAndroidId, securityTokenOrCallback, persistentIds, notificationCallback, keys) {
  let androidId = credentialsOrAndroidId;
  let securityToken = securityTokenOrCallback;

  if (credentialsOrAndroidId && typeof credentialsOrAndroidId === 'object') {
    const credentials = credentialsOrAndroidId;
    androidId = credentials.gcm?.androidId ?? credentials.androidId;
    securityToken = credentials.gcm?.securityToken ?? credentials.securityToken;
    persistentIds = credentials.persistentIds;
    notificationCallback = securityTokenOrCallback;
    keys = credentials.keys;
  }

  const client = new Client(androidId, securityToken, persistentIds, keys);
  if (typeof notificationCallback === 'function') {
    client.on('ON_NOTIFICATION_RECEIVED', notificationCallback);
  }
  await client.connect();
  return client;
}
