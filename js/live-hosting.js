const DEFAULT_ADDRESS = "0.0.0.0:8011";
const DEFAULT_RELOAD_PORT = 31108;
const SSCHARTER_VERSION = "0.10.1";
const WEBSOCKET_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_SIZE = 16 * 1024 * 1024;

function nwRequire(name) {
	try { return globalThis.nw?.require?.(name) || null; } catch { return null; }
}

function parseAddress(value = DEFAULT_ADDRESS) {
	const text = String(value).trim();
	const match = text.match(/^(.+):(\d+)$/);
	if (!match) throw new Error("Live hosting address must be host:port.");
	return { host: match[1].replace(/^\[|\]$/g, ""), port: Number(match[2]) };
}

function bufferFrom(value, BufferRef) {
	if (BufferRef.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return BufferRef.from(value);
	return BufferRef.from(String(value ?? ""));
}

function encodeWebSocketFrame(value, BufferRef, opcode = 0x1) {
	const payload = bufferFrom(value, BufferRef);
	if (payload.length > MAX_FRAME_SIZE) throw new Error("Live reload message is too large.");
	let header;
	if (payload.length < 126) {
		header = BufferRef.from([0x80 | opcode, payload.length]);
	} else if (payload.length <= 0xffff) {
		header = BufferRef.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(payload.length, 2);
	} else {
		header = BufferRef.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(payload.length), 2);
	}
	return BufferRef.concat([header, payload]);
}

function acceptKey(key, crypto) {
	return crypto.createHash("sha1").update(`${key}${WEBSOCKET_MAGIC}`).digest("base64");
}

function handleWebSocketBytes(client, chunk, BufferRef) {
	client.buffer = BufferRef.concat([client.buffer, chunk]);
	while (client.buffer.length >= 2) {
		const first = client.buffer[0];
		const second = client.buffer[1];
		const opcode = first & 0x0f;
		const masked = Boolean(second & 0x80);
		let length = second & 0x7f;
		let headerLength = 2;
		if (length === 126) {
			if (client.buffer.length < 4) return;
			length = client.buffer.readUInt16BE(2);
			headerLength = 4;
		} else if (length === 127) {
			if (client.buffer.length < 10) return;
			const largeLength = client.buffer.readBigUInt64BE(2);
			if (largeLength > BigInt(MAX_FRAME_SIZE)) throw new Error("Live reload frame is too large.");
			length = Number(largeLength);
			headerLength = 10;
		}
		const maskLength = masked ? 4 : 0;
		const frameLength = headerLength + maskLength + length;
		if (length > MAX_FRAME_SIZE) throw new Error("Live reload frame is too large.");
		if (client.buffer.length < frameLength) return;
		const fin = Boolean(first & 0x80);
		const mask = masked ? client.buffer.subarray(headerLength, headerLength + 4) : null;
		const payload = client.buffer.subarray(headerLength + maskLength, frameLength);
		client.buffer = client.buffer.subarray(frameLength);
		const unmasked = BufferRef.from(payload);
		if (mask) for (let index = 0; index < unmasked.length; index += 1) unmasked[index] ^= mask[index % 4];
		if (opcode === 0x8) { client.close(); return; }
		if (opcode === 0x9) { client.pong(unmasked); continue; }
		if (opcode === 0xa) continue;
		if (opcode === 0x0) {
			if (!client.fragments) continue;
			client.fragments.push(unmasked);
			if (!fin) continue;
			const message = BufferRef.concat(client.fragments).toString("utf8");
			client.fragments = null;
			client.onMessage(message);
			continue;
		}
		if (opcode !== 0x1) continue;
		if (!fin) {
			client.fragments = [unmasked];
			continue;
		}
		client.onMessage(unmasked.toString("utf8"));
	}
}

export class LiveHosting {
	constructor(options = {}) {
		this.onClientClose = options.onClientClose || (() => {});
		this.http = null;
		this.crypto = null;
		this.Buffer = null;
		this.server = null;
		this.reloadServer = null;
		this.clients = new Set();
		this.address = options.address || DEFAULT_ADDRESS;
		this.reloadPort = Number(options.reloadPort ?? DEFAULT_RELOAD_PORT) || 0;
		this.getLevel = options.getLevel || (() => null);
		this.onMessage = options.onMessage || (() => {});
		this.onError = options.onError || (() => {});
		this.onStop = options.onStop || (() => {});
		this.stopping = false;
		this.stopReported = false;
	}

	#reportError(error) {
		try { this.onError(error instanceof Error ? error : new Error(String(error))); }
		catch { /* Notifications must not interrupt server cleanup. */ }
	}

	#listen(server, port, host) {
		return new Promise((resolve, reject) => {
			const cleanup = () => { server.off("error", failed); server.off("listening", listening); };
			const failed = error => { cleanup(); reject(error); };
			const listening = () => { cleanup(); resolve(); };
			server.once("error", failed);
			server.once("listening", listening);
			server.listen(port, host);
		});
	}

	#watch(server) {
		server.on("error", error => this.#reportError(error));
		server.on("close", () => {
			if (this.stopping || this.stopReported) return;
			this.stopReported = true;
			this.stop();
			try { this.onStop(); } catch { /* Notifications must not interrupt cleanup. */ }
		});
	}

	async start() {
		if (!globalThis.nw) throw new Error("Live hosting is available only in NW.js.");
		if (this.server) return this;
		this.stopping = false;
		this.stopReported = false;
		this.http = nwRequire("http");
		this.crypto = nwRequire("crypto");
		this.Buffer = nwRequire("buffer")?.Buffer || globalThis.Buffer;
		if (!this.http || !this.crypto || !this.Buffer) throw new Error("Node HTTP/WebSocket modules are unavailable.");
		const { host, port } = parseAddress(this.address);
		this.server = this.http.createServer((request, response) => {
			if (request.url !== "/sviber.ssc") {
				response.statusCode = 404;
				response.end();
				return;
			}
			Promise.resolve(this.getLevel()).then(body => {
				const value = bufferFrom(body, this.Buffer);
				response.writeHead(200, {
					"Access-Control-Allow-Origin": "*",
					"Cache-Control": "no-cache, no-store",
					"Content-Type": "application/zip",
					"Content-Length": value.length,
				});
				response.end(value);
			}).catch(error => {
				this.#reportError(error);
				response.statusCode = 500;
				response.end();
			});
		});
		await this.#listen(this.server, port, host);
		this.#watch(this.server);
		if (this.reloadPort > 0) await this.#startReload();
		return this;
	}

	async #startReload() {
		this.reloadServer = this.http.createServer();
		this.reloadServer.on("upgrade", (request, socket, head) => {
			const key = request.headers["sec-websocket-key"];
			if (request.headers.upgrade?.toLowerCase() !== "websocket" || !key) {
				socket.destroy();
				return;
			}
			const client = {
				buffer: this.Buffer.alloc(0),
				fragments: null,
				socket,
				address: String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "unknown",
				send: value => socket.write(encodeWebSocketFrame(value, this.Buffer)),
				pong: value => socket.write(encodeWebSocketFrame(value, this.Buffer, 0x0a)),
				close: () => socket.end(encodeWebSocketFrame(this.Buffer.alloc(0), this.Buffer, 0x08)),
				onMessage: message => this.#handleMessage(client, message),
			};
			const response = [
				"HTTP/1.1 101 Switching Protocols",
				"Upgrade: websocket",
				"Connection: Upgrade",
				`Sec-WebSocket-Accept: ${acceptKey(key, this.crypto)}`,
				"\r\n",
			].join("\r\n");
			socket.write(response);
			this.clients.add(client);
			socket.on("data", chunk => {
				try { handleWebSocketBytes(client, chunk, this.Buffer); }
				catch (error) { this.#reportError(error); client.close(); }
			});
			const remove = () => {
				if (!this.clients.delete(client)) return;
				try { this.onClientClose(client); } catch { /* Notifications must not interrupt cleanup. */ }
			};
			socket.on("close", remove);
			socket.on("error", error => { remove(); this.#reportError(error); });
			if (head?.length) {
				try { handleWebSocketBytes(client, head, this.Buffer); }
				catch (error) { this.#reportError(error); client.close(); }
			}
		});
		await this.#listen(this.reloadServer, this.reloadPort, "0.0.0.0");
		this.#watch(this.reloadServer);
	}

	#handleMessage(client, message) {
		let data;
		try { data = JSON.parse(message); } catch { return; }
		if (!data || typeof data !== "object") return;
		if (data.type === "eventInfoTip") return;
		if (!["connect", "update", "chartUpdate"].includes(data.type)) return;
		this.onMessage(data, client);
	}

	broadcast(message) {
		if (!this.clients.size) return;
		const payload = JSON.stringify(message);
		for (const client of this.clients) {
			try { client.send(payload); }
			catch (error) { this.#reportError(error); client.close(); this.clients.delete(client); }
		}
	}

	stop() {
		this.stopping = true;
		for (const client of this.clients) client.close();
		this.clients.clear();
		this.server?.close();
		this.reloadServer?.close();
		this.server = null;
		this.reloadServer = null;
	}
}

export { DEFAULT_ADDRESS, DEFAULT_RELOAD_PORT, SSCHARTER_VERSION, parseAddress, encodeWebSocketFrame };
