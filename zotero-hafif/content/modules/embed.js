/* Anlamsal arama: kütüphanenin yerel gömme (embedding) dizini.
 * Her kayıt için künye + özet + etiketler, her not için metni ve (isteğe bağlı) her PDF/EPUB
 * için sayfa sayfa tam metin parçaları gömülür. Vektörler normalleştirilip 8 bitlik tamsayıya
 * çevrilir (4 kat küçük) ve Zotero veri klasöründe hafif/embed/<model>/ altında durur; arama
 * tamamen bu bilgisayarda yapılır, sağlayıcıya yalnızca metinler gömülmek için gider.
 * Dizin artımlıdır: yalnızca değişen ya da yeni metinler yeniden gömülür. */

Hafif.modules.embed = {
	CHUNK: 1100,
	OVERLAP: 150,
	BATCH: 64,

	/** Sağlayıcıya göre önerilen gömme modeli ve boyutu. */
	DEFAULTS: {
		openai: { model: "text-embedding-3-small", dims: 512 },
		google: { model: "gemini-embedding-001", dims: 768 },
		mistral: { model: "mistral-embed" },
		voyage: { model: "voyage-3.5", dims: 512 },
		ollama: { model: "bge-m3" },
		lmstudio: { model: "text-embedding-bge-m3" },
	},

	_mem: null,
	_job: null,

	// ---- Ayar ----

	config() {
		let v = Hafif.pref("aiEmbed") || "";
		let [provider, ...rest] = v.split(":");
		if (!provider) return null;
		let model = rest.join(":") || this.DEFAULTS[provider]?.model;
		if (!model) return null;
		let dims = this.DEFAULTS[provider]?.model === model ? this.DEFAULTS[provider].dims : null;
		return { provider, model, dims, id: `${provider}-${model}${dims ? "-" + dims : ""}`.replace(/[^\w.-]+/g, "_") };
	},

	_dir(cfg = this.config()) {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "embed", cfg.id);
	},

	// ---- Sağlayıcılar ----

	/** Metinleri gömer; normalleştirilmiş Float32Array dizisi döndürür. */
	async embed(texts, { query = false, cfg = this.config(), signal } = {}) {
		if (!cfg) throw new Error("Anlamsal arama için gömme modeli seçilmemiş (Ayarlar › Hafif › Yapay zekâ).");
		let llm = Hafif.load("llm");
		let p = llm.provider(cfg.provider);
		if (!p) throw new Error("Gömme sağlayıcısı bulunamadı: " + cfg.provider);
		if (p.key && !p.apiKey && !p.custom) throw new Error(`${p.label} için API anahtarı yok.`);
		let vecs;
		if (cfg.provider === "google") {
			let body = {
				requests: texts.map(t => ({
					model: "models/" + cfg.model,
					content: { parts: [{ text: t }] },
					taskType: query ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
					...(cfg.dims ? { outputDimensionality: cfg.dims } : {}),
				})),
			};
			let r = await this._post(`${p.base}/models/${encodeURIComponent(cfg.model)}:batchEmbedContents`, { "x-goog-api-key": p.apiKey }, body, signal);
			vecs = (r.embeddings || []).map(e => e.values);
		}
		else if (cfg.provider === "voyage") {
			let r = await this._post("https://api.voyageai.com/v1/embeddings", { authorization: "Bearer " + p.apiKey },
				{ model: cfg.model, input: texts, input_type: query ? "query" : "document", ...(cfg.dims ? { output_dimension: cfg.dims } : {}) }, signal);
			vecs = r.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
		}
		else {
			// OpenAI ve uyumluları (Mistral, Ollama, LM Studio, kendi sunucunuz)
			let body = { model: cfg.model, input: texts };
			if (cfg.dims && /^text-embedding-3/.test(cfg.model)) body.dimensions = cfg.dims;
			let r = await this._post(`${p.base}/embeddings`, p.apiKey ? { authorization: "Bearer " + p.apiKey } : {}, body, signal);
			vecs = (r.data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
		}
		if (vecs.length !== texts.length) throw new Error(`Gömme sayısı uyuşmuyor (${vecs.length}/${texts.length}).`);
		return vecs.map(v => this._norm(Float32Array.from(v)));
	},

	async _post(url, headers, body, signal) {
		for (let attempt = 0; ; attempt++) {
			let res = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
			if (res.ok) return res.json();
			let text = await res.text();
			// Hız sınırında bekleyip yeniden dene
			if ((res.status === 429 || res.status >= 500) && attempt < 5) {
				let wait = (+res.headers.get("retry-after") || 2 ** attempt) * 1000;
				await new Promise(r => setTimeout(r, Math.min(wait, 30000)));
				continue;
			}
			throw new Error(Hafif.load("llm")._errMsg(res.status, text));
		}
	},

	_norm(v) {
		let s = 0;
		for (let i = 0; i < v.length; i++) s += v[i] * v[i];
		s = Math.sqrt(s) || 1;
		for (let i = 0; i < v.length; i++) v[i] /= s;
		return v;
	},

	/** Normalleştirilmiş vektör → 8 bit (−127…127) ve ölçeği: v ≈ q · k. */
	_q(v) {
		let max = 0;
		for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
		let k = (max || 1) / 127;
		let q = new Int8Array(v.length);
		for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / k);
		return { q, k };
	},

	_hash(s) {
		let h = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(36) + s.length.toString(36);
	},

	// ---- Dizin dosyaları ----

	async load(cfg = this.config()) {
		if (!cfg) return null;
		if (this._mem?.id === cfg.id) return this._mem;
		let dir = this._dir(cfg);
		let mem = { id: cfg.id, dims: 0, entries: [], vec: new Int8Array(0), at: 0 };
		try {
			let meta = await IOUtils.readJSON(PathUtils.join(dir, "meta.json"));
			let bytes = await IOUtils.read(PathUtils.join(dir, "vec.bin"));
			mem = { id: cfg.id, dims: meta.dims, entries: meta.entries, at: meta.at, vec: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
			if (mem.vec.length !== mem.entries.length * mem.dims) throw new Error("dizin bozuk");
		}
		catch (e) {
			mem = { id: cfg.id, dims: 0, entries: [], vec: new Int8Array(0), at: 0 };
		}
		this._mem = mem;
		return mem;
	},

	async _save(mem, cfg) {
		let dir = this._dir(cfg);
		await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
		await IOUtils.write(PathUtils.join(dir, "vec.bin"), new Uint8Array(mem.vec.buffer, mem.vec.byteOffset, mem.vec.byteLength), { tmpPath: PathUtils.join(dir, "vec.bin.tmp") });
		await IOUtils.writeJSON(PathUtils.join(dir, "meta.json"), { dims: mem.dims, at: mem.at, entries: mem.entries }, { tmpPath: PathUtils.join(dir, "meta.json.tmp") });
	},

	async status() {
		let cfg = this.config();
		if (!cfg) return { configured: false };
		let mem = await this.load(cfg);
		let items = new Set(mem.entries.map(e => e.lib + "/" + e.item));
		return {
			configured: true, cfg, chunks: mem.entries.length, items: items.size,
			text: mem.entries.filter(e => e.kind === "text").length, at: mem.at, running: !!this._job,
		};
	},

	// ---- Dizinlenecek metinler ----

	_metaText(it) {
		let T = Hafif.load("libtools");
		let parts = [it.getField("title")];
		let cr = it.getCreators().map(c => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name).filter(Boolean);
		if (cr.length) parts.push(cr.join(", "));
		let y = T.year(it);
		if (y) parts.push(y);
		for (let f of ["publicationTitle", "bookTitle", "publisher", "series"]) {
			let v = it.getField(f);
			if (v) parts.push(v);
		}
		let abs = it.getField("abstractNote");
		if (abs) parts.push(abs);
		let tags = it.getTags().map(t => t.tag).filter(t => !t.startsWith("/"));
		if (tags.length) parts.push("Etiketler: " + tags.join(", "));
		return parts.filter(Boolean).join(". ").slice(0, 6000);
	},

	_chunks(text, size = this.CHUNK, overlap = this.OVERLAP) {
		text = text.replace(/\s+/g, " ").trim();
		if (!text) return [];
		if (text.length <= size) return [text];
		let out = [];
		for (let i = 0; i < text.length; i += size - overlap) {
			let end = Math.min(text.length, i + size);
			// Kelime ortasında bölme
			let s = i ? text.indexOf(" ", i) + 1 || i : 0;
			let e = end < text.length ? text.lastIndexOf(" ", end) : end;
			if (e <= s) e = end;
			out.push(text.slice(s, e));
			if (end >= text.length) break;
		}
		return out;
	},

	/** Kütüphaneden olması gereken parçalar: { id, lib, item, att, page, kind, text } */
	async *_wanted({ fulltext, signal }) {
		let T = Hafif.load("libtools");
		for (let lib of T.libraries()) {
			let items = await Zotero.Items.getAll(lib.libraryID, true, false);
			for (let it of items) {
				if (signal?.aborted) return;
				if (it.deleted) continue;
				if (it.isRegularItem()) {
					yield { id: `${it.key}|m`, lib: lib.libraryID, item: it.key, kind: "meta", text: this._metaText(it) };
					for (let nid of it.getNotes()) {
						let n = Zotero.Items.get(nid);
						if (n && !n.deleted) yield* this._noteChunks(n, lib.libraryID, it.key);
					}
					if (fulltext) {
						let att = await T.documentOf(it);
						if (att && !att.deleted && (await att.getFilePathAsync())) {
							let pages;
							try {
								pages = await T.pages(att);
							}
							catch (e) {
								continue;
							}
							for (let p = 0; p < pages.length; p++) {
								let cs = this._chunks(pages[p] || "");
								for (let j = 0; j < cs.length; j++) {
									if (cs[j].length > 80) yield { id: `${it.key}|${att.key}|${p}|${j}`, lib: lib.libraryID, item: it.key, att: att.key, page: p + 1, kind: "text", text: cs[j] };
								}
							}
						}
					}
				}
				else if (it.isNote()) yield* this._noteChunks(it, lib.libraryID, it.key);
			}
		}
	},

	*_noteChunks(n, lib, item) {
		let text = Hafif.load("libtools")._noteText(n.getNote());
		let title = n.getNoteTitle();
		let chunks = this._chunks(text, 1600, 200);
		for (let j = 0; j < chunks.length && j < 40; j++) {
			yield { id: `${n.key}|n|${j}`, lib, item, note: n.key, kind: "note", text: (j ? title + ": " : "") + chunks[j] };
		}
	},

	// ---- Güncelleme ----

	/**
	 * Dizini artımlı günceller. onProgress({ done, total, phase }).
	 * Değişmeyen parçaların vektörü yeniden kullanılır; silinenler atılır.
	 */
	async update({ fulltext = Hafif.pref("aiEmbedFulltext") === true, onProgress, signal } = {}) {
		if (this._job) return this._job;
		let cfg = this.config();
		if (!cfg) throw new Error("Önce bir gömme modeli seçin.");
		let run = async () => {
			let mem = await this.load(cfg);
			let old = new Map(mem.entries.map((e, i) => [e.id, { e, i }]));
			let dims = mem.dims;
			let keep = [];
			let todo = [];
			onProgress?.({ phase: "Metinler toplanıyor…", done: 0, total: 0 });
			let seen = 0;
			for await (let w of this._wanted({ fulltext, signal })) {
				if (signal?.aborted) break;
				let h = this._hash(w.text);
				let o = old.get(w.id);
				if (o && o.e.h === h) keep.push({ e: o.e, i: o.i });
				else todo.push({ ...w, h });
				if (++seen % 500 === 0) onProgress?.({ phase: `Metinler toplanıyor… (${seen})`, done: 0, total: 0 });
			}
			if (signal?.aborted) throw new DOMException("Durduruldu", "AbortError");
			let entries = keep.map(k => k.e);
			let chunksVec = [];
			if (dims) for (let k of keep) chunksVec.push(mem.vec.subarray(k.i * dims, (k.i + 1) * dims));
			let total = todo.length;
			let done = 0;
			let saveEvery = 20;
			let batchNo = 0;
			let flush = async () => {
				let vec = new Int8Array(entries.length * dims);
				chunksVec.forEach((v, i) => vec.set(v, i * dims));
				mem = this._mem = { id: cfg.id, dims, entries: entries.slice(), vec, at: Date.now() };
				await this._save(mem, cfg);
			};
			for (let i = 0; i < todo.length; i += this.BATCH) {
				if (signal?.aborted) break;
				let batch = todo.slice(i, i + this.BATCH);
				let vecs = await this.embed(batch.map(b => b.text), { cfg, signal });
				if (!dims) dims = vecs[0].length;
				batch.forEach((b, j) => {
					if (vecs[j].length !== dims) return;
					let { text, ...rest } = b;
					let { q, k } = this._q(vecs[j]);
					entries.push({ ...rest, k: +k.toPrecision(6), s: text.slice(0, 240) });
					chunksVec.push(q);
				});
				done += batch.length;
				onProgress?.({ phase: "Gömülüyor", done, total });
				// Uzun işlerde ara kayıt: durdurulsa da emek kaybolmaz
				if (++batchNo % saveEvery === 0) await flush();
			}
			if (!dims) dims = mem.dims || 0;
			await flush();
			return { added: done, kept: keep.length, removed: old.size - keep.length, total: entries.length, stopped: !!signal?.aborted };
		};
		this._job = run().finally(() => {
			this._job = null;
		});
		return this._job;
	},

	// ---- Arama ----

	/** Sorguya en yakın parçalar, kayıt başına gruplanmış. */
	async search(query, { limit = 12, kinds = null, libraryID = null, collection = null } = {}) {
		let cfg = this.config();
		if (!cfg) return { error: "Anlamsal arama için gömme modeli seçilmemiş." };
		let mem = await this.load(cfg);
		if (!mem.entries.length) return { error: "Anlamsal dizin henüz oluşturulmamış (Ayarlar › Hafif › Yapay zekâ › Anlamsal dizin)." };
		let [qv] = await this.embed([query], { query: true, cfg });
		let { q, k: qk } = this._q(qv);
		if (q.length !== mem.dims) return { error: "Dizin başka bir modelle oluşturulmuş; dizini yeniden oluşturun." };
		let allowItems = null;
		if (collection) {
			let c = Hafif.load("libtools")._collectionByRef(collection);
			allowItems = new Set();
			let walk = (x) => {
				for (let it of x.getChildItems(false, false)) allowItems.add(it.key);
				for (let k of x.getChildCollections(false)) walk(k);
			};
			walk(c);
		}
		let mask = null;
		if (kinds || libraryID || allowItems) {
			mask = new Uint8Array(mem.entries.length);
			mem.entries.forEach((e, i) => {
				mask[i] = (kinds && !kinds.includes(e.kind)) || (libraryID && e.lib !== libraryID) || (allowItems && !allowItems.has(e.item)) ? 0 : 1;
			});
		}
		// Kosinüs benzerliği (vektörler normal): en iyi adaylar, büyük dizinde ayrı iş parçacığında
		let top = await this._top(mem, q, qk, mask, Math.max(500, limit * 40));
		let scores = {};
		top.idx.forEach((i, j) => {
			scores[i] = top.score[j];
		});
		let byItem = new Map();
		for (let i of top.idx) {
			let e = mem.entries[i];
			let key = e.lib + "/" + e.item;
			let g = byItem.get(key);
			if (!g) {
				if (byItem.size >= limit) continue;
				g = { lib: e.lib, item: e.item, score: +scores[i].toFixed(3), hits: [] };
				byItem.set(key, g);
			}
			if (g.hits.length < 3) g.hits.push({ kind: e.kind, page: e.page, att: e.att, note: e.note, text: e.s, score: +scores[i].toFixed(3) });
			if (byItem.size >= limit && [...byItem.values()].every(x => x.hits.length >= 3)) break;
		}
		return { results: [...byItem.values()] };
	},

	// ---- Puanlama ----

	WORKER_MIN: 4000,
	_worker: null,
	_workerMem: null,
	_reqs: new Map(),
	_reqID: 0,

	_vec() {
		if (!this._vecLib) {
			let scope = {};
			Services.scriptloader.loadSubScript("chrome://hafif/content/windows/vecmath.js", scope);
			this._vecLib = scope.HafifVec;
		}
		return this._vecLib;
	},

	_scales(mem) {
		if (!mem._scales) mem._scales = Float32Array.from(mem.entries, e => e.k);
		return mem._scales;
	},

	/** En yüksek puanlı `top` girdi. Küçük dizinde doğrudan, büyükte işçide hesaplanır. */
	async _top(mem, q, qk, mask, top) {
		let n = mem.entries.length;
		if (n >= this.WORKER_MIN) {
			try {
				return await this._workerTop(mem, q, qk, mask, top);
			}
			catch (e) {
				Zotero.debug("[Hafif] anlamsal arama işçisi kullanılamadı, ana iş parçacığında: " + e.message);
			}
		}
		return this._vec().topScores(mem.vec, mem.dims, n, this._scales(mem), q, qk, mask, top);
	},

	_ensureWorker() {
		if (this._worker) return this._worker;
		let win = Zotero.getMainWindow();
		let W = win?.ChromeWorker || win?.Worker;
		if (!W) throw new Error("işçi oluşturulamıyor");
		let w = new W("chrome://hafif/content/windows/embedworker.js");
		w.onmessage = (e) => {
			let m = e.data;
			if (m.type !== "result") return;
			let r = this._reqs.get(m.req);
			if (!r) return;
			this._reqs.delete(m.req);
			if (m.error) r.reject(new Error(m.error));
			else r.resolve({ idx: new Int32Array(m.idx), score: new Float32Array(m.score) });
		};
		w.onerror = (e) => {
			for (let r of this._reqs.values()) r.reject(new Error(e.message || "işçi hatası"));
			this._reqs.clear();
			this._worker = null;
			this._workerMem = null;
		};
		this._worker = w;
		return w;
	},

	_workerTop(mem, q, qk, mask, top) {
		let w = this._ensureWorker();
		if (this._workerMem !== mem) {
			let vec = mem.vec.slice();
			let scales = this._scales(mem).slice();
			w.postMessage({ type: "load", id: mem.at + ":" + mem.entries.length, vec: vec.buffer, scales: scales.buffer, dims: mem.dims, n: mem.entries.length }, [vec.buffer, scales.buffer]);
			this._workerMem = mem;
		}
		let req = ++this._reqID;
		return new Promise((resolve, reject) => {
			this._reqs.set(req, { resolve, reject });
			let qq = Int8Array.from(q);
			let mm = mask ? mask.slice() : null;
			w.postMessage({ type: "search", req, id: mem.at + ":" + mem.entries.length, q: qq.buffer, qk, mask: mm?.buffer || null, top }, mm ? [qq.buffer, mm.buffer] : [qq.buffer]);
		});
	},

	/** Kütüphane değişince (ayar açıksa) birkaç dakika sonra sessizce günceller. */
	scheduleAuto() {
		if (Hafif.pref("aiEmbedAuto") === false || !this.config()) return;
		let win = Zotero.getMainWindow();
		if (!win) return;
		win.clearTimeout(this._autoTimer);
		this._autoTimer = win.setTimeout(async () => {
			try {
				let st = await this.status();
				if (st.chunks && !this._job) await this.update();
			}
			catch (e) {
				Zotero.debug("[Hafif] anlamsal dizin otomatik güncellenemedi: " + e.message);
			}
		}, 3 * 60 * 1000);
	},

	shutdown() {
		this._worker?.terminate();
		this._worker = null;
		Zotero.getMainWindow()?.clearTimeout(this._autoTimer);
	},
};
