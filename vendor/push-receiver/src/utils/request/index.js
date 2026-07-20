"use strict";

const { waitFor } = require("../timeout");

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 3;
const MAX_RETRY_DELAY_SECONDS = 15;
const RETRY_STEP_SECONDS = 5;

module.exports = requestWithRetry;

async function requestWithRetry(options) {
    const retryOptions = options.retry || {};
    const retries = retryOptions.retries ?? DEFAULT_RETRIES;

    for (let attempt = 0; ; attempt += 1) {
        try {
            return await requestOnce(options);
        } catch (error) {
            if (attempt >= retries) {
                throw error;
            }

            const delayMilliseconds = retryOptions.delayMilliseconds ??
                Math.min(attempt * RETRY_STEP_SECONDS, MAX_RETRY_DELAY_SECONDS) * 1000;
            console.error(`Request failed: ${error.message}`);
            console.error(`Retrying in ${delayMilliseconds / 1000} seconds`);
            await waitFor(delayMilliseconds);
        }
    }
}

async function requestOnce(options) {
    const {
        url,
        method = "GET",
        headers = {},
        form,
        json = false,
        encoding,
        timeoutMilliseconds = DEFAULT_TIMEOUT_MS,
        signal,
    } = options;
    let { body } = options;

    if (!url) {
        throw new TypeError("Request URL is required");
    }

    const requestHeaders = new Headers(headers);
    if (form) {
        body = new URLSearchParams();
        for (const [key, value] of Object.entries(form)) {
            body.append(key, String(value));
        }
        if (!requestHeaders.has("Content-Type")) {
            requestHeaders.set("Content-Type", "application/x-www-form-urlencoded");
        }
    } else if (json && body !== undefined && !isBodyValue(body)) {
        body = JSON.stringify(body);
        if (!requestHeaders.has("Content-Type")) {
            requestHeaders.set("Content-Type", "application/json");
        }
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds);
    const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body,
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });

    const responseBody = encoding === null
        ? Buffer.from(await response.arrayBuffer())
        : json
            ? await response.json()
            : await response.text();

    if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`.trim());
        error.statusCode = response.status;
        error.response = { statusCode: response.status, body: responseBody };
        throw error;
    }

    return responseBody;
}

function isBodyValue(value) {
    return typeof value === "string" ||
        Buffer.isBuffer(value) ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        value instanceof URLSearchParams ||
        value instanceof Blob ||
        value instanceof FormData;
}
