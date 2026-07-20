"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const protobuf = require("protobufjs");

const RustPlus = require("../rustplus");
const pushReceiver = require("@liamcottle/push-receiver");

const proto = protobuf.loadSync(path.resolve(__dirname, "../rustplus.proto"));
const AppRequest = proto.lookupType("rustplus.AppRequest");
const AppMessage = proto.lookupType("rustplus.AppMessage");

test("does not load the optional camera stack with the core runtime", () => {
    assert.equal(require.cache[require.resolve("../camera")], undefined);
});

test("exports the RustIQ runtime contract", () => {
    assert.equal(typeof RustPlus, "function");

    for (const method of [
        "connect",
        "disconnect",
        "isConnected",
        "on",
        "off",
        "sendRequestAsync",
    ]) {
        assert.equal(typeof RustPlus.prototype[method], "function", method);
    }
});

test("resolves the RustIQ push receiver contract", () => {
    assert.equal(typeof pushReceiver.AndroidFCM, "function");
    assert.equal(typeof pushReceiver.AndroidFCM.register, "function");
});

test("camera support fails clearly when optional Jimp is not installed", () => {
    const client = new RustPlus("127.0.0.1", 28082, "1", 1);
    assert.throws(
        () => client.getCamera("RUSTIQ"),
        /requires the optional jimp dependency/,
    );
});

test("loads rustplus.proto and round-trips AppRequest and AppMessage", () => {
    const requestBytes = AppRequest.encode(AppRequest.fromObject({
        seq: 7,
        playerId: "76561198000000000",
        playerToken: 12345,
        getInfo: {},
    })).finish();
    const request = AppRequest.decode(requestBytes);

    assert.equal(request.seq, 7);
    assert.equal(request.playerId.toString(), "76561198000000000");
    assert.equal(request.playerToken, 12345);
    assert.ok(request.getInfo);

    const messageBytes = AppMessage.encode(AppMessage.fromObject({
        response: { seq: 7, success: {} },
    })).finish();
    const message = AppMessage.decode(messageBytes);

    assert.equal(message.response.seq, 7);
    assert.ok(message.response.success);
});

test("ignores unknown protobuf fields and rejects truncated payloads", () => {
    const validMessage = AppMessage.encode(AppMessage.fromObject({
        response: { seq: 1, success: {} },
    })).finish();
    const withUnknownField = Buffer.concat([
        validMessage,
        Buffer.from([0x98, 0x06, 0x01]),
    ]);

    assert.equal(AppMessage.decode(withUnknownField).response.seq, 1);
    assert.throws(() => AppMessage.decode(Buffer.from([0x0a, 0x05, 0x08])));
});

test("isConnected is false before connect and after disconnect", () => {
    const client = new RustPlus("127.0.0.1", 28082, "1", 1);

    assert.equal(client.isConnected(), false);

    let terminated = false;
    client.websocket = {
        readyState: 1,
        terminate() {
            terminated = true;
        },
    };

    assert.equal(client.isConnected(), true);
    client.disconnect();
    assert.equal(terminated, true);
    assert.equal(client.isConnected(), false);
});

test("sendRequestAsync removes its callback after timeout", async () => {
    const client = new RustPlus("127.0.0.1", 28082, "1", 1);
    client.AppRequest = AppRequest;
    client.websocket = { send() {} };

    await assert.rejects(
        client.sendRequestAsync({ getInfo: {} }, 5),
        /Timeout reached while waiting for response/,
    );
    assert.equal(Object.keys(client.seqCallbacks).length, 0);
});
