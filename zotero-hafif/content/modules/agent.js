/* Araştırma ajanı: model ile kütüphane araçları arasındaki döngü ve sohbet geçmişi.
 * Model araç isterse araçlar (paralel) çalıştırılır, sonuçlar geri verilir; model metinle
 * bitirene kadar sürer. Sohbetler Zotero veri klasöründe hafif/threads/ altında JSON olarak durur. */

Hafif.modules.agent = {
	MAX_STEPS: 25,

	SYSTEM: `Sen Zotero içinde çalışan bir araştırma asistanısın. Kullanıcı İslâm ilimleri ve fıkıh tarihi alanında çalışan bir akademisyen; kütüphanesi Türkçe, Arapça ve Batı dillerinde kaynaklar içerir.

Nasıl çalışırsın:
- Önce kullanıcının kendi kütüphanesine bak. Soru kütüphanedeki kaynaklarla ilgiliyse araçları kullan; genel bilgiyle yetinme.
- Arama stratejini birleştir: search_library ile künye araması, fulltext_search ile PDF içi arama, search_in_document ile tek belgede sayfa bulma, read_document ile ilgili sayfaları okuma, find_annotations ile kullanıcının vurgularına bakma, search_notes/read_note ile notlarına bakma. Sonuç zayıfsa farklı yazımlar (Arapça/Latin harfli transkripsiyon, Türkçe/Osmanlıca karşılıklar, eşanlamlılar) ile yeniden ara.
- Kavram ya da soru üzerinden kaynak ararken semantic_search de kullan: kelimesi geçmese de anlamca ilgili kayıtları, not ve PDF bölümlerini (başka dillerdeki karşılıklarıyla) bulur.
- Kütüphane her zaman önce gelir. Kütüphanede yeterli kaynak yoksa ya da kullanıcı yeni/güncel literatür, eksik kaynak, atıf ağı isterse search_literature, get_work ve citation_network ile dış literatüre bak; dış kaynakları kütüphanedekilerden açıkça ayır ve DOI'leriyle ver (atıf işaretini yalnızca kütüphanedeki kayıtlar için kullan). Kullanıcı isterse import_by_identifier ile kütüphaneye ekle.
- Tez (YÖK), Türkçe dergi makalesi (DergiPark) ya da TDV İslâm Ansiklopedisi maddesi aranırken search_scholarly kullan; tez türü, alan, yıl ve dil süzgeçlerini kullanıcının isteğinden çıkar. Eklemek istenirse import_scholarly.
- Bir PDF'in künyesi eksik/yanlışsa ya da üst kaydı yoksa extract_metadata ile künyeyi PDF'ten çıkar.
- Birbirinden bağımsız aramaları aynı adımda paralel yap.
- Bir iddiayı kaynağa dayandırıyorsan önce o kaynağın ilgili sayfasını gerçekten oku.

Atıf kuralı (zorunlu):
- Kütüphanedeki bir kaynağa dayanan her cümlenin sonuna atıf koy. En iyisi cümle düzeyinde atıftır: [[ANAHTAR, s. 12, "dayanak cümleden 5-20 kelime"]] — tırnak içindeki metin, read_document çıktısındaki metnin harfi harfine kopyası olmalı (kullanıcı tıklayınca PDF'te tam o cümle vurgulanır). Alıntı veremiyorsan [[ANAHTAR, s. 12]], sayfa da bilinmiyorsa [[ANAHTAR]].
- ANAHTAR, araç sonuçlarındaki 8 karakterlik kayıt anahtarıdır (ek anahtarı değil, üst kaydın anahtarı). Sayfa, read_document çıktısındaki [[s. N]] işaretindeki PDF sayfasıdır; basılı sayfa numarasını atıfa yazma, panel onu kendisi gösterir.
- Atıfı uydurma; görmediğin sayfayı yazma. Kütüphanede bulamadığın bilgiyi genel bilgi olarak açıkça belirt.

PDF'e işlem:
- Kullanıcı vurgulama, işaretleme, not düşme isterse create_highlights kullan; alıntıları önce read_document ile oku, sonra birebir kopyala. Renk isteği varsa uygula (örn. yöntem mavi, bulgular sarı). Kullanıcı onaylamadan hiçbir şey eklenmez.
- Metin katmanı olmayan (taranmış) sayfaları, tabloları ve şekilleri view_page ile görüntüsünden oku. Kullanıcı taranmış bir eserle uzun süre çalışacaksa ocr_document ile metne çevirmeyi öner (kalıcı olur, sonra aranabilir).
- Birden çok kaynağı aynı sorulara göre karşılaştırmak (literatür tablosu, yöntem/bulgu/görüş karşılaştırması) istenirse build_table kullan ve tabloyu kullanıcıya aynen göster; ardından kısa bir değerlendirme ekle.

Notlar ve kütüphane:
- Kullanıcı not yazmanı, özetini nota kaydetmeni, notuna eklemeni isterse create_note / edit_note kullan. Var olan notu düzenlemeden önce read_note ile oku; başlık yapısını koru, kullanıcının yazdıklarını silme (yalnızca açıkça isterse replace/rewrite). Notlarda atıfları [[ANAHTAR, s. N, "alıntı"]] biçiminde yaz: nota gerçek Zotero atıfı olarak girer.
- Künye düzeltme (update_item), etiket (manage_tags), koleksiyon (manage_collections, create_collection) ve DOI/ISBN ile kayıt ekleme (import_by_identifier) araçlarını yalnızca kullanıcı böyle bir düzenleme istediğinde kullan. Toplu işlerde önce neyin değişeceğini araçlarla tespit et, sonra tek çağrıda uygula.
- Değişiklik yapan her araç kullanıcıya önizleme gösterir ve onay bekler; kullanıcı reddederse ısrar etme, ne değiştirmek istediğini sor. Onaylanan değişiklikler geri alınabilir.
- Doğrudan alıntıyı tırnak içinde, kaynağındaki gibi (Arapça ise Arapça) ver.

Yanıt biçimi:
- Kullanıcının dilinde yaz (çoğunlukla Türkçe), akademik ve açık bir üslupla. Arapça terimleri ve transkripsiyonu koru.
- Markdown kullan: kısa başlıklar, gerektiğinde madde listesi, karşılaştırmalarda tablo. Gereksiz giriş-sonuç cümlesi yazma.
- Bulamadığın ya da emin olmadığın şeyi söyle.`,

	// ---- Sohbet kayıtları ----

	_dir() {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "threads");
	},

	newThread() {
		let id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		return { id, title: "", created: Date.now(), updated: Date.now(), messages: [], model: null };
	},

	async save(thread) {
		if (!thread.messages.length) return;
		thread.updated = Date.now();
		await IOUtils.makeDirectory(this._dir(), { createAncestors: true, ignoreExisting: true });
		// Görseller (sayfa görüntüleri) diske yazılmaz; sohbet yine okunabilir kalır
		let lean = JSON.parse(JSON.stringify(thread, (k, v) => {
			if (k === "images") return undefined;
			if (v && v.type === "image" && v.data) return { type: "text", text: "(görsel)" };
			return v;
		}));
		await IOUtils.writeJSON(PathUtils.join(this._dir(), thread.id + ".json"), lean);
		let index = await this.list();
		index = index.filter(t => t.id !== thread.id);
		index.unshift({ id: thread.id, title: thread.title || "(başlıksız)", updated: thread.updated });
		await IOUtils.writeJSON(PathUtils.join(this._dir(), "index.json"), index.slice(0, 1000));
	},

	async load(id) {
		return IOUtils.readJSON(PathUtils.join(this._dir(), id + ".json"));
	},

	async list() {
		try {
			let idx = await IOUtils.readJSON(PathUtils.join(this._dir(), "index.json"));
			return Array.isArray(idx) ? idx : [];
		}
		catch (e) {
			return [];
		}
	},

	async remove(id) {
		try {
			await IOUtils.remove(PathUtils.join(this._dir(), id + ".json"));
		}
		catch (e) {}
		let index = (await this.list()).filter(t => t.id !== id);
		await IOUtils.writeJSON(PathUtils.join(this._dir(), "index.json"), index);
	},

	// ---- Bağlam ----

	/** Ekrandaki durumun kısa tarifi: her kullanıcı mesajının başına eklenir. */
	/** Okuyucudaki açık sayfanın metni (bağlama eklenir; en çok birkaç saniye beklenir). */
	async _pageText(ctx) {
		if (ctx?.kind !== "reader" || !ctx.page) return "";
		let T = Hafif.load("libtools");
		try {
			let pages = await Promise.race([T.pages(ctx.attachment), new Promise(r => setTimeout(() => r(null), 4000))]);
			let t = pages?.[ctx.page - 1] || "";
			return t.length > 7000 ? t.slice(0, 7000) + "…" : t;
		}
		catch (e) {
			return "";
		}
	},

	describeContext(ctx) {
		let T = Hafif.load("libtools");
		if (!ctx) return "";
		let lines = [];
		if (ctx.kind === "reader") {
			let s = T.summary(ctx.item);
			lines.push(`Kullanıcı şu an okuyucuda bu belgeyi okuyor: ${JSON.stringify(s)} (ek anahtarı ${ctx.attachment.key})`
				+ (ctx.page ? `, açık sayfa: PDF s. ${ctx.page}${ctx.pageLabel && ctx.pageLabel != ctx.page ? ` (basılı sayfa numarası ${ctx.pageLabel})` : ""}` : "") + ".");
			lines.push("“Bu makale/kitap/sayfa” gibi ifadeler bu belgeyi gösterir.");
		}
		else {
			if (ctx.collection) lines.push(`Kütüphanede açık koleksiyon: “${ctx.collection.name}” (${ctx.collection.key}).`);
			let items = (ctx.items || []).filter(i => i.isRegularItem() || i.isNote() || i.isAttachment()).slice(0, 15);
			if (items.length) {
				lines.push(`Kullanıcının seçili kayıtları (“bunlar”, “seçtiklerim”): ` + items.map(i => JSON.stringify(T.summary(i))).join("; "));
			}
		}
		if (ctx.pageText) lines.push(`Açık sayfanın (PDF s. ${ctx.page}) metni:\n"""\n${ctx.pageText}\n"""`);
		if (ctx.selection) lines.push(`Kullanıcının PDF'te seçtiği metin${ctx.selectionPage ? ` (PDF s. ${ctx.selectionPage})` : ""}: «${ctx.selection}»`);
		return lines.length ? `<bağlam>\n${lines.join("\n")}\n</bağlam>\n\n` : "";
	},

	system() {
		let extra = (Hafif.pref("aiInstructions") || "").trim();
		let today = new Date().toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" });
		return this.SYSTEM + `\n\nBugünün tarihi: ${today}.` + (extra ? `\n\nKullanıcının kalıcı talimatları:\n${extra}` : "");
	},

	/** Bütün araçlar: okuyanlar (libtools) ve değiştirenler (libedit). */
	tools() {
		return [...Hafif.load("libtools").tools(), ...Hafif.load("research").tools(), ...Hafif.load("sources").tools(), ...Hafif.load("tables").tools(), ...Hafif.load("metaextract").tools(), ...Hafif.load("libedit").tools()];
	},

	// ---- Döngü ----

	/**
	 * Kullanıcı mesajını ekler ve ajanı çalıştırır.
	 * on: { onStep(msgIndex), onText(delta), onThinking(delta), onToolStart(block), onToolEnd(block, result, isError), onUsage(u) }
	 */
	async run(thread, userText, { context, images = [], signal, on = {} } = {}) {
		let llm = Hafif.load("llm");
		let T = Hafif.load("libtools");
		let { provider, model } = thread.model || llm.current();
		thread.model = { provider, model };
		let tools = this.tools();
		let byName = Object.fromEntries(tools.map(t => [t.name, t]));
		let spec = tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));

		if (context?.kind === "reader" && !context.pageText) context.pageText = await this._pageText(context);
		let content = [{ type: "text", text: this.describeContext(context) + userText }];
		for (let img of images) content.push({ type: "image", mediaType: img.mediaType, data: img.data });
		thread.messages.push({ role: "user", content, display: userText, ts: Date.now() });
		if (!thread.title) thread.title = userText.replace(/\s+/g, " ").slice(0, 80);

		let usage = { input: 0, output: 0 };
		for (let step = 0; step < this.MAX_STEPS; step++) {
			if (signal?.aborted) break;
			let msg = { role: "assistant", content: [], ts: Date.now(), model: `${provider}:${model}` };
			thread.messages.push(msg);
			on.onStep?.(thread.messages.length - 1);
			let res = await llm.chat({
				provider, model,
				system: this.system(),
				messages: thread.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
				tools: spec,
				signal,
				effort: Hafif.pref("aiEffort") || "medium",
				webSearch: Hafif.pref("aiWebSearch") === true,
				onText: on.onText,
				onThinking: on.onThinking,
			});
			msg.content = res.content;
			usage.input += res.usage?.input || 0;
			usage.output += res.usage?.output || 0;
			on.onUsage?.(usage);

			if (res.stop === "refusal") {
				msg.content.push({ type: "text", text: "\n\n_Model bu isteği yanıtlamayı reddetti._" });
				break;
			}
			if (res.stop === "max_tokens") {
				msg.content.push({ type: "text", text: "\n\n_[Yanıt uzunluk sınırında kesildi.]_" });
				break;
			}
			let calls = res.content.filter(b => b.type === "tool_use");
			if (res.stop === "pause" && !calls.length) continue;
			if (!calls.length) break;

			let results = await Promise.all(calls.map(async (call) => {
				on.onToolStart?.(call);
				let tool = byName[call.name];
				let out, isError = false;
				try {
					if (!tool) throw new Error(`Bilinmeyen araç: ${call.name}`);
					if (call.input?.__invalid) throw new Error(call.input.__invalid);
					out = await tool.run(call.input || {}, {
						context, signal,
						// Değişiklik yapan araçlar önce kullanıcıya sorar (ayarlardan kapatılabilir)
						approve: async (preview) => {
							if (Hafif.pref("aiAutoApprove") === true) return true;
							return on.onApprove ? !!(await on.onApprove(call, preview)) : false;
						},
						registerUndo: (label, fn) => on.onUndo?.(call, label, fn),
					});
				}
				catch (e) {
					isError = true;
					out = "Hata: " + (e.message || e);
				}
				let images = null;
				if (out && typeof out === "object") {
					images = out.images || null;
					out = out.text || "";
				}
				out = String(out ?? "");
				on.onToolEnd?.(call, out, isError);
				let result = { type: "tool_result", id: call.id, name: call.name, content: out, isError };
				if (images?.length) result.images = images;
				return result;
			}));
			thread.messages.push({ role: "user", content: results, toolResults: true, ts: Date.now() });
			if (step === this.MAX_STEPS - 1) {
				thread.messages.push({ role: "assistant", content: [{ type: "text", text: "_Adım sınırına ulaşıldı. “Devam et” yazarak sürdürebilirsiniz._" }], ts: Date.now() });
			}
		}
		thread.usage = {
			input: (thread.usage?.input || 0) + usage.input,
			output: (thread.usage?.output || 0) + usage.output,
		};
		await this.save(thread);
		return thread;
	},

	/** Yarıda kesilen ya da hata veren adımdan sonra sohbeti tutarlı bırakır (eşsiz araç çağrısı kalmasın). */
	repair(thread) {
		let last = thread.messages[thread.messages.length - 1];
		if (last?.role === "assistant") {
			let calls = last.content.filter(b => b.type === "tool_use");
			if (calls.length) {
				thread.messages.push({
					role: "user", toolResults: true, ts: Date.now(),
					content: calls.map(c => ({ type: "tool_result", id: c.id, name: c.name, content: "Kullanıcı tarafından durduruldu.", isError: true })),
				});
				thread.messages.push({ role: "assistant", content: [{ type: "text", text: "_Durduruldu._" }], ts: Date.now() });
			}
			else if (!last.content.some(b => b.type === "text" && b.text)) {
				last.content.push({ type: "text", text: "_Durduruldu._" });
			}
		}
		else if (last?.role === "user") {
			thread.messages.push({ role: "assistant", content: [{ type: "text", text: "_Durduruldu._" }], ts: Date.now() });
		}
	},
};
